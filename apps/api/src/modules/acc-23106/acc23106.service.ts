import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { runExclusive } from '../../common/locks';
import { monthLabel, monthsBetween } from '../../common/period';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseBankStatement, parseDate, text } from '../unit-bank/unit-bank.service';
import { PAYROLL_UNITS, UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { Acc23106SafarService } from './acc23106.safar.service';
import { PayrollFactsService } from '../payroll-facts/payroll-facts.service';
import { accrualMonth, KIND_LABELS, kindComponents, nameKey, purposeKind, purposeMonth, purposeName, purposeOrder, type PayoutKind } from './acc23106.purpose';
import { readStore, STORE_KEY, type ControlState, type MatchBy, type PayoutRow, type Store } from './acc23106.store';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › 23106 — xodimlarga to'lovlar hisob raqami (bayram puli, mukofot, xizmat safari …) ko'chirmasi.
//
// Ko'chirma (выписка) shakli: №пп, Дата документа, Дата обработки, № док, Наименование счёта, ИНН, № счёта, МФО,
// Обороты по дебету, Обороты по кредиту, Назначение платежа.
// Har to'lov (debet qatori) uchun:
//  • xodim — ИНН ustunidagi 14 xonali PINFL bo'yicha; bo'lmasa — izohdagi F.I.Sh. bo'yicha (Xodimlar bazasi, bo'lim ro'yxatlari);
//  • sana — hujjat sanasi; nima uchun — izohdan (bayram, mukofot, safar …); asos — buyruq sanasi va raqami;
//  • hisoblangan oy — izohdagi «… oyi uchun» oy nomi; bo'lmasa buyruq sanasi oyi; bo'lmasa to'lov oyi.
// Nazorat (ish haqi tarkibi va soliq hisoboti bilan): xodimga shu oy tarkibda shu turdagi summa hisoblanganmi,
// to'langani hisoblanganidan oshmaganmi (bank «qo'lga» — soliqlardan keyingi summani o'tkazadi), soliq hisobotida bormi.
// Xarajat yozuvlari YARATILMAYDI: bu to'lovlar ish haqi ichida allaqachon hisoblangan — ikki marta sanalmasin.
// Istisno — xizmat safari: u ish haqida ham, soliq hisobotida ham yo'q; tasdiqlangandan keyin bo'limlarga xarajat
// bo'lib yoziladi (acc23106.safar.service.ts).
// Hisob raqami (№ счёта) saqlanmaydi. Saqlash joyi: settings («acc23106.store») — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const KEY = STORE_KEY;
const MAX_ROWS = 20000;
const TOL = 100n; // 1 so'm

export type { MatchBy, ControlState, PayoutRow, MonthState, Batch, Store } from './acc23106.store';

const cap = (v: unknown, n: number) => text(v).slice(0, n);
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class Acc23106Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly unitPayroll?: UnitPayrollService,
    @Optional() private readonly safar?: Acc23106SafarService,
  ) {}

  private async store(): Promise<Store> {
    return readStore((await this.prisma.setting.findUnique({ where: { key: KEY } }))?.value ?? null);
  }

  // ═══════════ Shablon ═══════════

  async template(): Promise<{ buffer: Buffer; filename: string }> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Page 1', { views: [{ state: 'frozen', ySplit: 11 }] });
    ws.getCell('B9').value = 'Остаток:';
    ws.getCell('D9').value = 'Начало дня';
    ws.getCell('E9').value = 0;
    ws.getCell('H9').value = 'Конец дня';
    ws.getCell('I9').value = 0;
    const heads = ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'];
    const widths = [6, 12, 12, 12, 26, 16, 24, 8, 16, 14, 60];
    heads.forEach((h, i) => {
      const c = ws.getCell(11, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      ws.getColumn(i + 1).width = widths[i] ?? 14;
    });
    ws.getRow(11).height = 32;
    for (const col of [2, 3, 4, 6, 7, 8]) ws.getColumn(col).numFmt = '@';
    ws.getColumn(9).numFmt = '#,##0.00';
    ws.getColumn(10).numFmt = '#,##0.00';
    ws.getColumn(11).alignment = { wrapText: true, vertical: 'top' };
    const help = wb.addWorksheet("Yo'riqnoma");
    help.getColumn(1).width = 110;
    [
      "23106 — xodimlarga to'lovlar ko'chirmasi (bayram puli, mukofot, xizmat safari …)",
      '',
      "• Bankdan olingan ko'chirmani (выписка) «Page 1» varag'iga shu ustunlar bilan qo'ying (11-qator — sarlavha).",
      "• Xodim «ИНН» ustunidagi 14 xonali PINFL bo'yicha topiladi; bo'lmasa — izohdagi F.I.Sh. bo'yicha («… сотруднику FAMILIYA ISM OTA»).",
      "• «Назначение платежа»dan: nima uchun (bayram puli, mukofot, xizmat safari, moddiy yordam, ta'til puli …) va buyruq («13.01.2026 даги 00003-son буйрукка асосан …»).",
      "• Hisoblangan oy — izohdagi «… oyi uchun» (masalan, «январ ойи учун иш ҳақи»), bo'lmasa buyruq sanasi oyi. Nazorat: ish haqi tarkibi va soliq hisoboti bilan.",
      "• Xarajat yozuvi yaratilmaydi — bu to'lovlar ish haqida hisoblangan (ikki marta sanalmasin).",
      "• Istisno — xizmat safari: ish haqida ham, soliq hisobotida ham yo'q. Saqlangandan keyin «Xizmat safari» bo'limida xodimning joyi (bo'limi) ko'rsatiladi; tekshirib tasdiqlaganingizdan keyin shu joyga xarajat bo'lib yoziladi.",
    ].forEach((t, i) => {
      help.getCell(i + 1, 1).value = t;
      if (i === 0) help.getCell(1, 1).font = { bold: true, size: 12 };
    });
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: '23106-kochirma-shablon.xlsx' };
  }

  // ═══════════ Xodimni topish ═══════════

  private async people(pinfls: string[]) {
    const [registry, staffRow] = await Promise.all([
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true } }),
      this.prisma.setting.findUnique({ where: { key: 'unit.staff' } }),
    ]);
    const byPin = new Map<string, string>(registry.map((e) => [e.pinfl, e.fullName]));
    const staff = (staffRow?.value ?? {}) as Record<string, { pinfl?: string; fullName?: string }[]>;
    for (const list of Object.values(staff)) for (const s of Array.isArray(list) ? list : []) if (s?.pinfl && s.fullName && !byPin.has(s.pinfl)) byPin.set(s.pinfl, s.fullName);
    // Ism kaliti → PINFL (bir xil ismli ikki xodim — ism bo'yicha aniqlanmaydi)
    const byName = new Map<string, string | null>();
    for (const [p, n] of byPin) {
      const k = nameKey(n);
      if (!k.includes(' ')) continue;
      byName.set(k, byName.has(k) && byName.get(k) !== p ? null : p);
    }
    void pinfls;
    return { byPin, byName };
  }

  private resolve(r: { inn: string; commentName: string | null }, ppl: { byPin: Map<string, string>; byName: Map<string, string | null> }) {
    const d = r.inn.replace(/\D/g, '');
    if (/^\d{14}$/.test(d) && ppl.byPin.has(d)) return { pinfl: d, fullName: ppl.byPin.get(d)!, matchBy: 'PINFL' as MatchBy };
    if (r.commentName) {
      const p = ppl.byName.get(nameKey(r.commentName));
      if (p) return { pinfl: p, fullName: ppl.byPin.get(p)!, matchBy: 'NAME' as MatchBy };
    }
    // Reestrda yo'q, lekin PINFL bor — PINFL saqlanadi (keyin reestrga qo'shilsa topiladi)
    if (/^\d{14}$/.test(d)) return { pinfl: d, fullName: null, matchBy: null };
    return { pinfl: null, fullName: null, matchBy: null };
  }

  /** Fayl qatori → to'lov (izohdan tur, buyruq, F.I.Sh.) */
  private toRow(raw: { no: string; docDate: string; procDate: string | null; docNo: string; accountName: string; inn: string; mfo: string; debitTiyin: string; purpose: string }): Omit<PayoutRow, 'pinfl' | 'fullName' | 'matchBy'> {
    const order = purposeOrder(raw.purpose);
    // «… oyi uchun» (izohda oy nomi) — eng aniq; bo'lmasa buyruq oyi; bo'lmasa to'lov oyi
    return {
      no: cap(raw.no, 20),
      docDate: raw.docDate,
      procDate: raw.procDate,
      docNo: cap(raw.docNo, 60),
      accountName: cap(raw.accountName, 200),
      inn: cap(raw.inn, 20),
      mfo: cap(raw.mfo, 10),
      debitTiyin: raw.debitTiyin,
      purpose: cap(raw.purpose, 1000),
      kind: purposeKind(raw.purpose),
      orderDate: order.date,
      orderNo: order.no,
      // Buyruq to'lovdan 13 oydan ko'p oldin bo'lsa (sana xato) — to'lov oyi
      accrual: accrualMonth(raw.purpose, raw.docDate, order.date),
      commentName: purposeName(raw.purpose),
    };
  }

  // ═══════════ Nazorat ═══════════

  /** Hisoblangan oylar bo'yicha: tarkib (umumiy + bo'limlar) va soliq hisoboti */
  private async controlData(periods: string[]) {
    const comps = await this.prisma.salaryComponent.findMany({ select: { code: true, category: true } });
    const tarkib = new Map<string, Map<string, Map<string, bigint>>>(); // oy → pinfl → kod → summa
    const tarkibUploaded = new Set<string>();
    const soliq = new Map<string, Set<string>>(); // oy → pinfl
    if (!periods.length) return { comps, tarkib, tarkibUploaded, soliq };
    const put = (p: string, pinfl: string, code: string, v: bigint) => {
      const m = tarkib.get(p) ?? new Map<string, Map<string, bigint>>();
      const x = m.get(pinfl) ?? new Map<string, bigint>();
      x.set(code, (x.get(code) ?? 0n) + v);
      m.set(pinfl, x);
      tarkib.set(p, m);
    };
    // Tarkib va soliq hisoboti — hamma sahifa bilan bir xil qoida (bitta tarkib: umumiy yoki bo'limniki, qo'shilmaydi)
    const facts = new PayrollFactsService(this.prisma, this.unitPayroll);
    for (const p of periods) {
      const t = await facts.tarkib(p);
      if (t.generalUploaded || t.unitUploaded.length) tarkibUploaded.add(p);
      for (const [pinfl, f] of t.map) for (const [code, v] of Object.entries(f.items)) put(p, pinfl, code, v);
      soliq.set(p, new Set((await facts.soliq(p)).keys()));
    }
    return { comps, tarkib, tarkibUploaded, soliq };
  }

  /** Har to'lovga nazorat holati (xodim × hisoblangan oy × tur bo'yicha jamlab) */
  private async withControl(rows: PayoutRow[]) {
    const periods = [...new Set(rows.map((r) => r.accrual))];
    const d = await this.controlData(periods);
    const paid = new Map<string, bigint>();
    const gk = (r: PayoutRow) => `${r.pinfl}|${r.accrual}|${r.kind}`;
    for (const r of rows) if (r.pinfl) paid.set(gk(r), (paid.get(gk(r)) ?? 0n) + BigInt(r.debitTiyin));
    return rows.map((r) => {
      const inSoliq = r.pinfl ? (d.soliq.get(r.accrual)?.has(r.pinfl) ?? false) : false;
      const codes = kindComponents(r.kind, d.comps);
      let state: ControlState = 'NA';
      let tarkibTiyin: bigint | null = null;
      if (r.pinfl && codes) {
        if (!d.tarkibUploaded.has(r.accrual)) state = 'NO_TARKIB';
        else {
          const items = d.tarkib.get(r.accrual)?.get(r.pinfl);
          tarkibTiyin = 0n;
          for (const c of codes) tarkibTiyin += items?.get(c) ?? 0n;
          const sum = paid.get(gk(r)) ?? 0n;
          state = tarkibTiyin === 0n ? 'NOT_IN_TARKIB' : sum > tarkibTiyin + TOL ? 'OVER' : 'OK';
        }
      }
      return { ...r, kindLabel: KIND_LABELS[r.kind], inSoliq, tarkibTiyin: tarkibTiyin === null ? null : tarkibTiyin.toString(), paidGroupTiyin: r.pinfl ? (paid.get(gk(r)) ?? 0n).toString() : r.debitTiyin, control: state };
    });
  }

  private summary(rows: { kind: PayoutKind; debitTiyin: string; control: ControlState; pinfl: string | null; matchBy: MatchBy }[]) {
    const byKind = new Map<PayoutKind, { count: number; total: bigint }>();
    for (const r of rows) {
      const k = byKind.get(r.kind) ?? { count: 0, total: 0n };
      k.count += 1;
      k.total += BigInt(r.debitTiyin);
      byKind.set(r.kind, k);
    }
    const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
    return {
      count: rows.length,
      totalTiyin: rows.reduce((s, r) => s + BigInt(r.debitTiyin), 0n).toString(),
      people: new Set(rows.map((r) => r.pinfl).filter(Boolean)).size,
      byKind: [...byKind.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1)).map(([kind, v]) => ({ kind, label: KIND_LABELS[kind], count: v.count, totalTiyin: v.total.toString() })),
      matched: { pinfl: count((r) => r.matchBy === 'PINFL'), name: count((r) => r.matchBy === 'NAME'), none: count((r) => !r.matchBy) },
      control: { ok: count((r) => r.control === 'OK'), over: count((r) => r.control === 'OVER'), notInTarkib: count((r) => r.control === 'NOT_IN_TARKIB'), noTarkib: count((r) => r.control === 'NO_TARKIB'), na: count((r) => r.control === 'NA') },
    };
  }

  // ═══════════ Tahlil ═══════════

  async analyze(file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang (bank dasturidan «Excel» qilib oling)");
    }
    const p = parseBankStatement(wb);
    if (!p.rows.length) throw new BadRequestException(`Faylda to'lov (debet) qatori topilmadi${p.inflowCount ? ` — ${p.inflowCount} ta faqat kirim (kredit) qatori bor` : ''}`);
    const ppl = await this.people([]);
    const rows: PayoutRow[] = p.rows.map((r) => {
      const base = this.toRow(r);
      return { ...base, ...this.resolve(base, ppl) };
    });
    const controlled = await this.withControl(rows);
    const saved = (await this.store()).months;
    const months = [...new Set(rows.map((r) => r.docDate.slice(0, 7)))].sort().map((period) => {
      const list = rows.filter((r) => r.docDate.startsWith(period));
      const prev = saved[period];
      return {
        period,
        label: monthLabel(period),
        count: list.length,
        totalTiyin: list.reduce((s, r) => s + BigInt(r.debitTiyin), 0n).toString(),
        saved: prev ? { fileName: prev.fileName, savedAt: prev.savedAt, count: prev.rows.length } : null,
      };
    });
    return {
      fileName: String(file.originalname ?? '23106.xlsx').slice(0, 200),
      sheetName: p.sheetName,
      months,
      rows: controlled,
      invalid: p.invalid,
      inflow: { count: p.inflowCount, totalTiyin: p.inflowTiyin.toString() },
      summary: this.summary(controlled),
    };
  }

  // ═══════════ Saqlash ═══════════

  async commit(body: { fileName?: unknown; months?: unknown; rows?: unknown }, userId: string) {
    if (!Array.isArray(body?.months) || !body.months.length) throw new BadRequestException('Saqlash uchun kamida bitta oy tanlang');
    const months = [...new Set(body.months.map(String))].sort();
    if (months.some((p) => !PERIOD_RE.test(p))) throw new BadRequestException("Oy noto'g'ri");
    if (!Array.isArray(body.rows) || !body.rows.length) throw new BadRequestException("Ma'lumot yo'q");
    if (body.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : '23106.xlsx';
    const ppl = await this.people([]);
    const byMonth = new Map<string, PayoutRow[]>(months.map((p) => [p, []]));
    for (const raw of body.rows as Record<string, unknown>[]) {
      const docDate = parseDate(raw?.docDate);
      if (!docDate) throw new BadRequestException(`Sana noto'g'ri: ${cap(raw?.docDate, 20)}`);
      let debit: bigint;
      try {
        debit = BigInt(text(raw.debitTiyin) || '0');
      } catch {
        throw new BadRequestException(`Summa noto'g'ri: ${cap(raw?.docNo, 30)}`);
      }
      if (debit <= 0n) throw new BadRequestException(`Debet summasi bo'lmagan qator: ${cap(raw?.docNo, 30)}`);
      // Tur, buyruq va xodim serverda qayta aniqlanadi (qoidalar bitta joyda)
      const base = this.toRow({ no: cap(raw.no, 20), docDate, procDate: parseDate(raw.procDate), docNo: cap(raw.docNo, 60), accountName: cap(raw.accountName, 200), inn: cap(raw.inn, 20), mfo: cap(raw.mfo, 10), debitTiyin: debit.toString(), purpose: cap(raw.purpose, 1000) });
      byMonth.get(docDate.slice(0, 7))?.push({ ...base, ...this.resolve(base, ppl) });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const batchId = randomUUID();
    const now = new Date().toISOString();
    const result = await runExclusive(`setting:${KEY}`, async () => {
      const store = await this.store();
      let replaced = 0;
      const replacedMonths: string[] = [];
      let count = 0;
      let total = 0n;
      for (const p of months) {
        if (store.months[p]) {
          replaced += 1;
          replacedMonths.push(p);
        }
        const rows = byMonth.get(p)!;
        store.months[p] = { batchId, fileName, savedAt: now, uploadedBy: user?.fullName ?? '', rows };
        count += rows.length;
        total += rows.reduce((s, r) => s + BigInt(r.debitTiyin), 0n);
      }
      store.batches.push({ id: batchId, fileName, createdAt: now, uploadedBy: user?.fullName ?? '', months, rows: count, totalTiyin: total.toString(), status: 'COMMITTED', cancelledAt: null });
      if (store.batches.length > 200) store.batches = store.batches.slice(-200);
      const value = store as unknown as object;
      await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
      return { replaced, replacedMonths, count, total };
    });
    // Almashtirilgan oylardagi xizmat safari tasdiqlari bekor (eski to'lovlar xarajatda qolmasin) — qayta tasdiqlanadi
    const safarDropped = this.safar ? await this.safar.dropMonths(result.replacedMonths, "ko'chirma almashtirildi", userId) : 0;
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'acc_23106',
      entityId: batchId,
      summary: `23106 ko'chirmasi: ${months.map(monthLabel).join(', ')} — ${result.count} ta to'lov, ${(Number(result.total) / 100).toLocaleString('uz-UZ')} so'm${result.replaced ? `, ${result.replaced} oy almashtirildi` : ''}`,
    });
    return { success: true as const, batchId, months, saved: result.count, replacedMonths: result.replaced, totalTiyin: result.total.toString(), safarDropped };
  }

  // ═══════════ Ko'rish, tarix, bekor qilish ═══════════

  async view(from: string, to: string) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const months = monthsBetween(from, to);
    const store = await this.store();
    // Xodim nomlari jonli yangilanadi (reestrga keyin qo'shilganlar ham topiladi)
    const ppl = await this.people([]);
    const rows = months
      .flatMap((p) => store.months[p]?.rows ?? [])
      .map((r) => ({ ...r, ...this.resolve(r, ppl) }))
      .sort((a, b) => a.docDate.localeCompare(b.docDate) || a.docNo.localeCompare(b.docNo));
    const controlled = await this.withControl(rows);
    return {
      from: months[0],
      to: months[months.length - 1],
      months: months.map((p) => ({ period: p, label: monthLabel(p), saved: store.months[p] ? { fileName: store.months[p]!.fileName, savedAt: store.months[p]!.savedAt, uploadedBy: store.months[p]!.uploadedBy, count: store.months[p]!.rows.length } : null })),
      rows: controlled,
      summary: this.summary(controlled),
    };
  }

  async batches() {
    return [...(await this.store()).batches].reverse();
  }

  async cancel(id: string, userId: string) {
    const out = await runExclusive(`setting:${KEY}`, async () => {
      const store = await this.store();
      const b = store.batches.find((x) => x.id === id);
      if (!b) throw new NotFoundException('Yuklash topilmadi');
      if (b.status === 'CANCELLED') throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
      const removed: string[] = [];
      for (const p of b.months) {
        if (store.months[p]?.batchId === id) {
          delete store.months[p];
          removed.push(p);
        }
      }
      b.status = 'CANCELLED';
      b.cancelledAt = new Date().toISOString();
      const value = store as unknown as object;
      await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
      return { removed, fileName: b.fileName };
    });
    const safarDropped = this.safar ? await this.safar.dropMonths(out.removed, "ko'chirma bekor qilindi", userId) : 0;
    await this.audit.log({ userId, action: 'DELETE', entity: 'acc_23106', entityId: id, summary: `23106 ko'chirmasi bekor qilindi: ${out.fileName} (${out.removed.map(monthLabel).join(', ') || "oylar keyin almashtirilgan"})` });
    return { success: true as const, months: out.removed, safarDropped };
  }
}