import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { buildTemplateWorkbook, sheetKey } from '../../common/templates/sheet-template';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { matchPlace, placeKey } from './leases.match';
import { LeaseMonthsService } from './leases.months';
import { LeasesService } from './leases.service';
import { amountFor, currentPeriod, type TermLike } from './leases.shared';
import { CENTRAL_REGION, MONTH_LABELS, parseRentWorkbook, REGION_ORDER, RENT_SPEC, type RentRow } from './regional-rent.parse';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Hudud ijaralari — shablon (hududlar ketma-ketligida, tumanlar bilan, joriy ijaralar bilan to'ldirilgan),
// fayl tahlili (bazadagi ijaralar bilan solishtirish: yangi / o'zgaradi / bir xil / bo'sh) va tasdiqlash:
// tanlangan oygacha — yangi ijaralar yaratiladi, oylik summalar yangilanadi (o'sha oydan yangi shart), oylar yopiladi.
// Hammasi ijara modulining o'z servislari orqali (LeasesService, LeaseMonthsService) — tarix, audit, qayta yopish bilan.
// To'langan / to'lanmagan izohlari o'qilmaydi — faqat oylik hisoblangan summa.
// ═══════════════════════════════════════════════════════════

type Action = 'NEW' | 'UPDATE' | 'SAME' | 'EMPTY' | 'ERROR';

interface LeaseRow {
  id: string;
  title: string;
  number: string;
  regionCode: number;
  districtId: string | null;
  startPeriod: string;
  endPeriod: string | null;
  lessorName: string;
  lessorTin: string | null;
  terms: TermLike[];
}

interface Matched {
  row: RentRow;
  regionCode: number | null;
  districtId: string | null;
  districtName: string | null;
  approx: boolean;
  lease: LeaseRow | null;
}

const tiyin = (som: number) => BigInt(Math.round(som * 100));
const pad = (m: number) => String(m).padStart(2, '0');
/** h/x, apostroflar va qo'shimchalarsiz kalit (tuman nomlari turlicha yozilgani uchun) */
const loose = (s: string) =>
  sheetKey(s)
    .replace(/h/g, 'x')
    .replace(/(tumani|tuman|shahri|shahar|shaxri|shaxar|bolimi|bolim)$/, '');

@Injectable()
export class RegionalRentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leases: LeasesService,
    private readonly months: LeaseMonthsService,
  ) {}

  private async base() {
    const [regions, districts, leases, closes] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.district.findMany({ select: { id: true, regionCode: true, name: true, code: true }, orderBy: [{ regionCode: 'asc' }, { code: 'asc' }] }),
      this.prisma.lease.findMany({
        where: { deletedAt: null },
        select: { id: true, title: true, number: true, regionCode: true, districtId: true, startPeriod: true, endPeriod: true, lessorName: true, lessorTin: true, terms: { select: { validFrom: true, monthlyTiyin: true } } },
        orderBy: [{ regionCode: 'asc' }, { title: 'asc' }],
      }),
      this.prisma.leaseMonthClose.findMany({ where: { cancelledAt: null }, select: { period: true } }),
    ]);
    return { regions, districts, leases: leases as LeaseRow[], closed: new Set(closes.map((c) => c.period)) };
  }

  private regionName(code: number | null, regions: { code: number; name: string }[]) {
    return code === null ? 'Hudud aniqlanmadi' : (regions.find((r) => r.code === code)?.name ?? `Hudud ${code}`);
  }

  /** Tuman: aniq moslik, so'ng h/x va qo'shimchalarsiz, so'ng oxirgi so'z (yagona bo'lsa) */
  private district(text: string, list: { id: string; name: string }[]) {
    const m = matchPlace(text, list.map((d) => ({ key: placeKey(d.name), item: d })));
    if (m.item) return { item: m.item, approx: m.approximate };
    const k = loose(text);
    const same = list.filter((d) => loose(d.name) === k);
    if (same.length === 1) return { item: same[0]!, approx: true };
    const last = (s: string) => sheetKey(s.replace(/\b(tumani|tuman|shahri|shahar|т|ш)\b\.?/gi, '').split(/[\s.]+/).filter(Boolean).pop() ?? '').replace(/h/g, 'x');
    const lw = last(text);
    const byLast = lw.length >= 4 ? list.filter((d) => last(d.name) === lw) : [];
    if (byLast.length === 1) return { item: byLast[0]!, approx: true };
    return { item: null, approx: false };
  }

  /** Fayl qatorlari ↔ bazadagi ijaralar */
  private match(rows: RentRow[], b: Awaited<ReturnType<RegionalRentService['base']>>): Matched[] {
    const used = new Set<string>();
    const out: Matched[] = [];
    for (const row of rows) {
      const regionCode = row.regionCode;
      const dl = regionCode === null || regionCode === CENTRAL_REGION ? [] : b.districts.filter((d) => d.regionCode === regionCode);
      const d = regionCode === CENTRAL_REGION ? { item: null, approx: false } : this.district(row.district, dl);
      const pool = b.leases.filter((l) => l.regionCode === regionCode && !used.has(l.id));
      const no = sheetKey(row.contractNo);
      let lease =
        (no && pool.find((l) => sheetKey(l.number) === no && (!d.item || !l.districtId || l.districtId === d.item.id))) ||
        (d.item ? (pool.filter((l) => l.districtId === d.item!.id).length === 1 ? pool.find((l) => l.districtId === d.item!.id) : pool.find((l) => l.districtId === d.item!.id && (!no || sheetKey(l.number) === no))) : undefined) ||
        (!d.item && pool.filter((l) => !l.districtId).length === 1 ? pool.find((l) => !l.districtId) : undefined) ||
        null;
      if (lease) used.add(lease.id);
      out.push({ row, regionCode, districtId: lease?.districtId ?? d.item?.id ?? null, districtName: (lease?.districtId ? b.districts.find((x) => x.id === lease!.districtId)?.name : d.item?.name) ?? null, approx: d.approx, lease });
    }
    return out;
  }

  private async read(file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    await assertSafeXlsx(file.buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang");
    }
    const b = await this.base();
    const parsed = parseRentWorkbook(wb, b.regions);
    if (!parsed) throw new BadRequestException("Ijara ma'lumoti topilmadi: «Hudud ijaralari» shablonini yoki «Ижара маълумот» faylini yuklang");
    return { b, parsed, matched: this.match(parsed.rows, b), fileName: String(file.originalname ?? 'ijara.xlsx').slice(0, 200) };
  }

  private yearOf(input: unknown) {
    const y = Number(input) || Number(currentPeriod().slice(0, 4));
    if (y < 2020 || y > 2100) throw new BadRequestException("Yil noto'g'ri");
    return y;
  }

  /** Ko'rinish: hudud → tuman qatorlari (fayl yoki baza), oylar, holat va tekshiruvlar */
  private present(items: Matched[] | null, b: Awaited<ReturnType<RegionalRentService['base']>>, year: number) {
    const periods = MONTH_LABELS.map((_, i) => `${year}-${pad(i + 1)}`);
    const db = (l: LeaseRow) => periods.map((p) => amountFor(l, l.terms, p));
    const rows: {
      ref: string | null;
      regionCode: number | null;
      district: string;
      districtName: string | null;
      approx: boolean;
      leaseId: string | null;
      leaseTitle: string | null;
      action: Action | 'MISSING' | 'DB';
      months: string[];
      dbMonths: string[] | null;
      diff: number[];
      totalOk: boolean | null;
      warnings: string[];
    }[] = [];
    if (items) {
      for (const m of items) {
        const f = m.row.months.map(tiyin);
        const d = m.lease ? db(m.lease) : null;
        const has = f.some((x) => x !== 0n);
        const diff = d ? f.map((x, i) => (x !== 0n && x !== d[i] ? i : -1)).filter((i) => i >= 0) : [];
        const warnings = [...m.row.warnings];
        if (d) f.forEach((x, i) => x === 0n && d[i]! !== 0n && warnings.push(`${MONTH_LABELS[i]}: faylda 0, bazada ${Number(d[i]) / 100} — o'zgartirilmaydi`));
        if (m.regionCode !== null && m.regionCode !== CENTRAL_REGION && !m.districtId && has) warnings.push("Tuman tanilmadi — viloyat darajasida yoziladi");
        const sum12 = m.row.months.reduce((s, x) => s + x, 0);
        const totalOk = m.row.total === null || !m.row.total ? null : Math.abs(m.row.total - sum12) <= 1;
        if (totalOk === false) warnings.push(`«Жами» (${m.row.total}) ≠ 12 oy yig'indisi (${Math.round(sum12 * 100) / 100})`);
        const action: Action = m.regionCode === null ? 'ERROR' : !has ? 'EMPTY' : !m.lease ? 'NEW' : diff.length ? 'UPDATE' : 'SAME';
        if (action === 'ERROR') warnings.unshift(`Hudud aniqlanmadi: «${m.row.regionText}»`);
        rows.push({ ref: m.row.ref, regionCode: m.regionCode, district: m.row.district, districtName: m.districtName, approx: m.approx, leaseId: m.lease?.id ?? null, leaseTitle: m.lease?.title ?? null, action, months: f.map(String), dbMonths: d ? d.map(String) : null, diff, totalOk, warnings });
      }
      // Bazada bor, faylda yo'q (shu yil amalda) — ma'lumot uchun
      const usedIds = new Set(items.map((m) => m.lease?.id).filter(Boolean));
      for (const l of b.leases.filter((x) => !usedIds.has(x.id) && db(x).some((v) => v !== 0n))) {
        const d = db(l);
        rows.push({ ref: null, regionCode: l.regionCode, district: l.title, districtName: b.districts.find((x) => x.id === l.districtId)?.name ?? null, approx: false, leaseId: l.id, leaseTitle: l.title, action: 'MISSING', months: d.map(String), dbMonths: d.map(String), diff: [], totalOk: null, warnings: ["Faylda yo'q — bazadagi summasi bilan qoladi"] });
      }
    } else {
      for (const l of b.leases) {
        const d = db(l);
        if (!d.some((v) => v !== 0n)) continue;
        rows.push({ ref: null, regionCode: l.regionCode, district: l.title, districtName: b.districts.find((x) => x.id === l.districtId)?.name ?? null, approx: false, leaseId: l.id, leaseTitle: l.title, action: 'DB', months: d.map(String), dbMonths: d.map(String), diff: [], totalOk: null, warnings: [] });
      }
    }
    const order = (c: number | null) => (c === null ? 999 : REGION_ORDER.includes(c) ? REGION_ORDER.indexOf(c) : 500 + c);
    const codes = [...new Set(rows.map((r) => r.regionCode))].sort((x, y) => order(x) - order(y));
    const sumMonths = (rs: typeof rows) => periods.map((_, i) => rs.filter((r) => r.action !== 'EMPTY' && r.action !== 'ERROR').reduce((s, r) => s + BigInt(r.months[i]!), 0n).toString());
    const regions = codes.map((code) => {
      const rs = rows.filter((r) => r.regionCode === code).sort((x, y) => (x.districtName ?? x.district).localeCompare(y.districtName ?? y.district));
      return { code, name: this.regionName(code, b.regions), rows: rs, months: sumMonths(rs) };
    });
    const count = (a: string) => rows.filter((r) => r.action === a).length;
    return {
      year,
      periods,
      closed: periods.filter((p) => b.closed.has(p)),
      regions,
      months: sumMonths(rows),
      summary: { rows: rows.length, new: count('NEW'), update: count('UPDATE'), same: count('SAME'), empty: count('EMPTY'), error: count('ERROR'), missing: count('MISSING'), unmatchedDistricts: rows.filter((r) => r.action !== 'EMPTY' && r.regionCode !== null && r.regionCode !== CENTRAL_REGION && !r.districtName).length, totalBad: rows.filter((r) => r.totalOk === false).length },
    };
  }

  /** Bazadagi hozirgi holat (yuklashsiz) — hudud → tuman → oylar */
  async current(yearInput: unknown) {
    const year = this.yearOf(yearInput);
    return this.present(null, await this.base(), year);
  }

  /** Fayl tahlili — hech narsa saqlanmaydi */
  async analyze(file: Express.Multer.File | undefined, yearInput: unknown) {
    const year = this.yearOf(yearInput);
    const { b, parsed, matched, fileName } = await this.read(file);
    const view = this.present(matched, b, year);
    const now = currentPeriod();
    const lastWithData = view.periods.reduce((x, p, i) => (p <= now && view.months[i] !== '0' ? i + 1 : x), 0);
    return { fileName, format: parsed.format, sheets: parsed.sheets, skipped: parsed.skipped, untilDefault: lastWithData, ...view };
  }

  /** Tasdiqlash: tanlangan oygacha — ijaralar yaratiladi / yangilanadi, oylar (qayta) yopiladi */
  async commit(file: Express.Multer.File | undefined, yearInput: unknown, untilInput: unknown, userId: string) {
    const year = this.yearOf(yearInput);
    const until = Number(untilInput);
    if (!Number.isInteger(until) || until < 1 || until > 12) throw new BadRequestException("Qaysi oygacha — 1 dan 12 gacha");
    if (`${year}-${pad(until)}` > currentPeriod()) throw new BadRequestException("Kelajakdagi oyni yozib bo'lmaydi");
    const { b, matched, fileName } = await this.read(file);
    const bad = matched.filter((m) => m.regionCode === null && m.row.months.slice(0, until).some((x) => x));
    if (bad.length) throw new BadRequestException(`Hudud aniqlanmagan qatorlar bor: ${bad.slice(0, 5).map((m) => m.row.ref).join(', ')}`);
    const periods = Array.from({ length: until }, (_, i) => `${year}-${pad(i + 1)}`);
    let created = 0;
    let updated = 0;
    let same = 0;
    for (const m of matched) {
      const f = m.row.months.slice(0, until).map(tiyin);
      const idx = f.map((x, i) => (x !== 0n ? i : -1)).filter((i) => i >= 0);
      if (!idx.length || m.regionCode === null) continue;
      const first = periods[idx[0]!]!;
      const last = periods[idx[idx.length - 1]!]!;
      if (!m.lease) {
        // Yangi ijara: shu hududdagi boshqa ijaradan ijaraga beruvchi (faylda bo'lmasa)
        const peer = b.leases.find((l) => l.regionCode === m.regionCode);
        const name = m.districtName ?? m.row.district;
        const lease = await this.leases.create(
          {
            number: m.row.contractNo || 'Shartnomasiz',
            contractDate: m.row.contractDate,
            title: /bo'?lim/i.test(name) ? name : `${name} bo'limi`,
            regionCode: m.regionCode,
            districtId: m.districtId,
            address: m.row.address,
            areaM2: m.row.area,
            purpose: 'Ofis',
            lessorName: m.row.lessorName || peer?.lessorName || "Ko'rsatilmagan",
            lessorTin: m.row.lessorTin || peer?.lessorTin || null,
            startPeriod: first,
            monthlyTiyin: f[idx[0]!]!.toString(),
            note: `Hudud ijaralari: ${fileName}`,
          },
          userId,
        );
        const terms: TermLike[] = [{ validFrom: first, monthlyTiyin: f[idx[0]!]! }];
        for (const i of idx.slice(1)) {
          if (amountFor({ startPeriod: first, endPeriod: null }, terms, periods[i]!) !== f[i]) {
            await this.leases.setTerm(lease.id, { validFrom: periods[i]!, monthlyTiyin: f[i]!.toString() }, userId);
            terms.push({ validFrom: periods[i]!, monthlyTiyin: f[i]! });
          }
        }
        await this.leases.terminate(lease.id, { endPeriod: last, endReason: null });
        created++;
        continue;
      }
      // Mavjud ijara: boshlanish / tugash kengaytiriladi, farq qilgan oydan yangi shart
      const l = m.lease;
      let range = { startPeriod: l.startPeriod, endPeriod: l.endPeriod };
      const terms = [...l.terms];
      let changed = false;
      if (first < l.startPeriod) {
        await this.leases.update(l.id, { startPeriod: first });
        range = { ...range, startPeriod: first };
        changed = true;
      }
      if (range.endPeriod && last > range.endPeriod) {
        await this.leases.terminate(l.id, { endPeriod: last, endReason: null });
        range = { ...range, endPeriod: last };
        changed = true;
      }
      for (const i of idx) {
        if (amountFor(range, terms, periods[i]!) === f[i]) continue;
        await this.leases.setTerm(l.id, { validFrom: periods[i]!, monthlyTiyin: f[i]!.toString() }, userId);
        const at = terms.findIndex((t) => t.validFrom === periods[i]);
        if (at >= 0) terms.splice(at, 1);
        terms.push({ validFrom: periods[i]!, monthlyTiyin: f[i]! });
        changed = true;
      }
      if (changed) updated++;
      else same++;
    }
    const closes: { period: string; leaseCount: number; totalTiyin: string }[] = [];
    for (const p of periods) {
      const s = await this.months.close(p, userId, true);
      closes.push({ period: p, leaseCount: s.leaseCount, totalTiyin: s.totalTiyin });
    }
    await this.audit.log({ userId, action: 'IMPORT', entity: 'regional_rent', entityId: `${year}-${pad(until)}`, summary: `Hudud ijaralari: ${fileName} — ${year} yanvar–${MONTH_LABELS[until - 1]!.toLowerCase()}: yangi ${created}, yangilandi ${updated}, bir xil ${same}; ${periods.length} oy yopildi` });
    return { created, updated, same, closes };
  }

  /** Shablon: hududlar ketma-ketligida, har hudud ostida tumanlari; joriy ijaralar (manzil, shartnoma, oylik summa) bilan */
  async template(yearInput: unknown): Promise<{ buffer: Buffer; filename: string }> {
    const year = this.yearOf(yearInput);
    const b = await this.base();
    const wb = buildTemplateWorkbook(RENT_SPEC);
    const ws = wb.worksheets[0]!;
    ws.getCell(1, 1).value = `Hudud ijaralari — ${year} (oylik hisoblangan ijara, so'm)`;
    const col = (k: string) => RENT_SPEC.fields.findIndex((f) => f.key === k) + 1;
    const periods = MONTH_LABELS.map((_, i) => `${year}-${pad(i + 1)}`);
    const full = await this.prisma.lease.findMany({ where: { deletedAt: null }, select: { id: true, address: true, contractDate: true, areaM2: true } });
    const extra = new Map(full.map((l) => [l.id, l]));
    let r = 5;
    let no = 1;
    const put = (region: string, district: string, l: LeaseRow | null) => {
      const x = l ? extra.get(l.id) : null;
      const row = ws.getRow(r);
      row.getCell(col('no')).value = no++;
      row.getCell(col('region')).value = region;
      row.getCell(col('district')).value = district;
      if (l) {
        row.getCell(col('contractNo')).value = l.number;
        if (x?.address) row.getCell(col('address')).value = x.address;
        if (x?.contractDate) row.getCell(col('contractDate')).value = x.contractDate;
        if (x?.areaM2) row.getCell(col('area')).value = x.areaM2;
        periods.forEach((p, i) => {
          const v = amountFor(l, l.terms, p);
          if (v !== 0n) row.getCell(col(`m${i}`)).value = Number(v) / 100;
        });
      }
      const a = ws.getColumn(col('m0')).letter;
      const z = ws.getColumn(col('m11')).letter;
      row.getCell(col('total')).value = { formula: `SUM(${a}${r}:${z}${r})` };
      r++;
    };
    for (const code of REGION_ORDER) {
      const region = this.regionName(code, b.regions);
      const leases = b.leases.filter((l) => l.regionCode === code);
      if (code === CENTRAL_REGION) {
        for (const l of leases) put(region, l.title, l);
        continue;
      }
      for (const d of b.districts.filter((x) => x.regionCode === code)) {
        const own = leases.filter((l) => l.districtId === d.id);
        if (!own.length && /bolimboshli/.test(sheetKey(d.name))) continue;
        if (!own.length) put(region, d.name, null);
        for (const l of own) put(region, d.name, l);
      }
      for (const l of leases.filter((x) => !x.districtId)) put(region, l.title, l);
    }
    for (let c = 1; c <= RENT_SPEC.fields.length; c++) ws.getColumn(c).alignment = { vertical: 'middle' };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `hudud-ijaralari-${year}-shablon.xlsx` };
  }
}
