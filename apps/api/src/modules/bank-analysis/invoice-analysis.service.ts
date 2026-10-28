import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readSheetRows } from '../../common/files/xlsx-stream';
import { runExclusive } from '../../common/locks';
import { monthLabel } from '../../common/period';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { counterpartyKey, kindMatch, kindOf, purposeKey, type BankDir, type BankKind } from './bank-analysis.rules';
import { INVOICE_STORE_KEY, type KindVerdict } from './kind-engine';
import { BankAnalysisService, big, cap, type BankAnRow } from './bank-analysis.service';
import { detectOurInn, ikpuCode, ikpuName, INVOICE_STATUSES, invoiceDate, itemId, parseInvoiceRows, serviceMonth } from './invoice-analysis.parse';

// ═══════════════════════════════════════════════════════════
// Schyot-faktura tahlili (Xarajatlar / Daromadlar › Schyot-fakturalar) — NAZORAT MODELI.
//
// Didox / soliq.uz reyestri (katta fayl ham — oqim bilan) o'qiladi. Faqat «Подписан» va «Ожидает» fakturalar,
// summa — QQS bilan. Biz xaridor bo'lsak — kiruvchi (chiqim), sotuvchi bo'lsak — chiquvchi (kirim); bizning INN
// fayldan o'zi aniqlanadi (eng ko'p uchragan) yoki saqlanganidan olinadi.
// O'zi xarajat / daromadga YOZMAYDI. Bank ko'chirmasi bilan bir xil imkoniyatlar: o'xshashlar (kontragent + IKPU
// xizmat kodi) oyma-oy va o'sib boruvchi, bir martaliklar, guruh nomi va turi, har qator izohi, foydalanuvchi o'zi
// xohlasa — tanlab yo'naltirish (bekor qilish mumkin).
// Oy — xizmat oyi (izohdagi «за август», «с 01.06.2026»), bo'lmasa faktura sanasi oyi.
// Qayta yuklash: fayldagi fakturalar (ID bo'yicha) yangilanadi, fayldagi «Отказ»ga o'tganlari olib tashlanadi,
// faylda yo'q fakturalarga tegilmaydi (filtrlangan qism yuklansa ham boshqalari yo'qolmaydi).
// Saqlash: settings («invoice.analysis.store», «invoice.analysis.org») — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const INVOICE_KEY = INVOICE_STORE_KEY;
const ORG_KEY = 'invoice.analysis.org';
const ACCOUNT = 'faktura';
const ACCOUNT_LABEL = 'Schyot-fakturalar';
const MAX_ROWS = 60000;

/** Faktura qatori (bank qatori shakli + faktura maydonlari) */
export interface InvoiceRow extends BankAnRow {
  invoiceId: string;
  itemNo: string;
  status: string;
  docType: string;
  contract: string;
  contractDate: string | null;
  ikpu: string;
  unit: string;
  qty: number | null;
  priceTiyin: string;
  costTiyin: string;
  vatTiyin: string;
  vatRate: number | null;
  /** Xizmat oyi */
  period: string;
  /** Faktura izohi (ПРИМЕЧАНИЕ) */
  invoiceNote: string;
  /** Bizdagi filial (xaridor / sotuvchi filiali nomi) */
  ourBranch: string;
  batchId?: string;
}

const KOMMUNAL_RE = /возмещени\p{L}*\s*(затрат|расход)|электроэнерг|электроснаб|эл\.?\s*энерг|водоснаб|холодн\p{L}*\s*вод|горяч\p{L}*\s*вод|канализац|теплоснаб|отоплени|(?<![\p{L}])тбо(?![\p{L}])|тв[её]рд\p{L}*\s*бытов|мусор|уборк|пропуск|эксплуатац|эксплутац|содержани\p{L}*\s*помещ|покрытие\s*затрат|коммунал|kommunal/iu;
const IJARA_RE = /аренд|ижара|ijara|rental|лизинг/iu;

/**
 * Faktura turi (IKPU nomi va izoh bo'yicha):
 *  • ijara alohida; suv / elektr / issiqlik / chiqindi / tozalash / ekspluatatsiya / ruxsatnoma — kommunal;
 *  • IKPU «0…» — tovar (neft mahsulotlari — yoqilg'i), «1…» — xizmat (tovar, yoqilg'i, ichki o'tkazma bo'lmaydi);
 *  • bank xizmati (10403…), maslahat, IT xizmatlari (103…) — o'z turi;
 *  • fakturada «QQS» so'zi doim bor — soliq turini belgilamaydi.
 */
export function invoiceKind(dir: BankDir, r: Pick<InvoiceRow, 'ikpu' | 'purpose'>, counterparty: string): BankKind {
  const code = ikpuCode(r.ikpu);
  const text = `${ikpuName(r.ikpu)} ${r.purpose}`.replace(/(с|bilan|билан)?\s*(ндс|qqs|ққс)(\s*\d+\s*%)?/giu, ' ');
  if (dir === 'OUT') {
    // Tovar (IKPU «0…», «099…» — xizmatlar: elektr, chiqindi …)
    if (code.startsWith('0') && !code.startsWith('099')) {
      if (/^0271[0-1]/.test(code) && !/масл/iu.test(text)) return 'YOQILGI';
      return 'XARID';
    }
    if (/^\s*(аренд|ижара|ijara)/iu.test(r.purpose) || (/аренд|ижара|ijara/iu.test(r.purpose) && !KOMMUNAL_RE.test(r.purpose))) return 'IJARA';
    if (/^10403/.test(code) || /банковск\p{L}*\s*услуг|эквайринг|ekvayring/iu.test(text)) return 'BANK';
    if (KOMMUNAL_RE.test(text)) return 'KOMMUNAL';
    if (IJARA_RE.test(text)) return 'IJARA';
    if (/^103/.test(code) || /консалт|консультац|maslahat|маслаҳат|маслахат|картридж|ремонт|таъмир|ta.?mir/iu.test(text)) {
      const k = kindOf(dir, text, counterparty);
      return k === 'ALOQA' ? 'ALOQA' : 'XIZMAT';
    }
  }
  const k = kindOf(dir, text, counterparty);
  // Xizmat fakturasi — tovar, yoqilg'i, ichki o'tkazma yoki depozit emas
  if (dir === 'OUT' && code.startsWith('1') && ['XARID', 'YOQILGI', 'ICHKI', 'DEPOZIT', 'SOLIQ'].includes(k)) return 'XIZMAT';
  if (dir === 'IN' && ['ICHKI', 'DEPOZIT'].includes(k)) return 'TUSHUM';
  return k;
}

/** Faktura turi — sababi bilan (IKPU kodi yoki izohdagi so'z); aniqlanmasa — NONE */
export function invoiceVerdict(dir: BankDir, r: Pick<InvoiceRow, 'ikpu' | 'purpose'>, counterparty: string): KindVerdict {
  const kind = invoiceKind(dir, r, counterparty);
  if (kind === 'BOSHQA') return { kind, source: 'NONE', reason: 'IKPU va izohdan aniqlanmadi' };
  const code = ikpuCode(r.ikpu);
  if (code) return { kind, source: 'IKPU', reason: `IKPU ${code}${ikpuName(r.ikpu) ? ` — ${ikpuName(r.ikpu).slice(0, 80)}` : ''}` };
  const m = kindMatch(dir, r.purpose, counterparty);
  return m.kind === kind ? m : { kind, source: 'KEYWORD', reason: 'Izoh bo‘yicha' };
}

/** O'xshashlik kaliti: yo'nalish + kontragent + IKPU xizmat kodi (bo'lmasa — izoh mazmuni) */
export function invoiceGroupKey(r: Pick<BankAnRow, 'dir' | 'inn' | 'accountName' | 'purpose'> & { ikpu?: string }): string {
  const code = ikpuCode(r.ikpu ?? '');
  return `${r.dir}|${counterpartyKey(r.inn, r.accountName)}|${code ? `ikpu:${code}` : purposeKey(r.purpose)}`;
}

@Injectable()
export class InvoiceAnalysisService extends BankAnalysisService {
  protected override readonly key: string = INVOICE_KEY;
  protected override readonly sourceLabel: string = 'Schyot-faktura';
  protected override readonly entity: string = 'invoice_analysis';

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  protected override periodOf(r: BankAnRow): string {
    return (r as InvoiceRow).period || r.docDate.slice(0, 7);
  }

  /** O'xshashlik: yo'nalish + kontragent + IKPU xizmat kodi (bo'lmasa — izoh mazmuni) */
  protected override keyOf(r: BankAnRow): string {
    return invoiceGroupKey(r as InvoiceRow);
  }

  protected override baseVerdict(r: BankAnRow, counterparty: string): KindVerdict {
    return invoiceVerdict(r.dir, { ikpu: (r as InvoiceRow).ikpu ?? '', purpose: r.purpose }, counterparty);
  }

  private async org(): Promise<{ inn: string; name: string } | null> {
    const v = (await this.prisma.setting.findUnique({ where: { key: ORG_KEY } }))?.value as { inn?: string; name?: string } | null;
    return v?.inn && /^\d{9}$/.test(v.inn) ? { inn: v.inn, name: v.name ?? '' } : null;
  }

  // ═══════════ Yuklash ═══════════

  /** Faylni o'qish (katta fayl ham — oqim bilan) — hech narsa saqlanmaydi */
  override async analyze(file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const { rows: sheet, truncated } = await readSheetRows(file.buffer, { maxRows: MAX_ROWS });
    const { invoices, invalid, checks } = parseInvoiceRows(sheet);
    if (!invoices.length) throw new BadRequestException('Faylda schyot-faktura topilmadi');
    const saved = await this.org();
    const detected = detectOurInn(invoices);
    const org = saved ?? detected;
    if (!org) throw new BadRequestException("Bizning korxona INN'i aniqlanmadi — fakturalarda xaridor yoki sotuvchi sifatida eng ko'p uchragan INN topilmadi");

    const statuses = new Map<string, number>();
    let other = 0;
    const rows: InvoiceRow[] = [];
    const include = new Set<string>(INVOICE_STATUSES);
    for (const inv of invoices) {
      statuses.set(inv.status || '—', (statuses.get(inv.status || '—') ?? 0) + 1);
      if (!include.has(inv.status)) continue;
      const dir: BankDir | null = inv.buyerInn === org.inn ? 'OUT' : inv.sellerInn === org.inn ? 'IN' : null;
      if (!dir) {
        other += 1;
        continue;
      }
      inv.items.forEach((it, idx) => {
        if (big(it.totalTiyin) <= 0n) return;
        const purpose = it.name || ikpuName(it.ikpu) || inv.note || 'Schyot-faktura';
        rows.push({
          id: itemId(inv.id, it, idx),
          invoiceId: inv.id,
          itemNo: it.no,
          docDate: inv.date,
          procDate: null,
          docNo: inv.number,
          accountName: dir === 'OUT' ? inv.sellerName : inv.buyerName,
          inn: dir === 'OUT' ? inv.sellerInn : inv.buyerInn,
          mfo: '',
          dir,
          amountTiyin: it.totalTiyin,
          purpose,
          status: inv.status,
          docType: inv.docType,
          contract: inv.contract,
          contractDate: inv.contractDate,
          ikpu: it.ikpu,
          unit: it.unit,
          qty: it.qty,
          priceTiyin: it.priceTiyin,
          costTiyin: it.costTiyin,
          vatTiyin: it.vatTiyin,
          vatRate: it.vatRate,
          period: serviceMonth(`${it.name} ${inv.note}`, inv.date),
          invoiceNote: inv.note,
          ourBranch: dir === 'OUT' ? inv.buyerBranch : inv.sellerBranch,
        });
      });
    }
    if (!rows.length) throw new BadRequestException(`Tahlilga olinadigan faktura yo'q: faqat «${INVOICE_STATUSES.join('», «')}» holatidagilar va bizning korxona (${org.inn}) xaridor yoki sotuvchi bo'lganlari olinadi`);
    const periods = [...new Set(rows.map((r) => r.period))].sort();
    const store = await this.store();
    const known = new Set(Object.values(store.accounts[ACCOUNT]?.months ?? {}).flatMap((m) => m.rows.map((r) => (r as InvoiceRow).invoiceId)));
    const included = new Set(rows.map((r) => r.invoiceId));
    return {
      fileName: String(file.originalname ?? 'fakturalar.xlsx').slice(0, 200),
      sheetName: 'Счет-фактура',
      org: { ...org, source: saved ? 'SAVED' : 'DETECTED' },
      account: { suggested: ACCOUNT_LABEL, known: [] },
      statuses: [...statuses.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count, included: include.has(status) })),
      invoices: { total: invoices.length, included: included.size, other, update: [...included].filter((id) => known.has(id)).length },
      /** Fayldagi hamma faktura ID (holatidan qat'i nazar) — qayta yuklashda yangilanadi / olib tashlanadi */
      allIds: invoices.map((i) => i.id),
      truncated,
      months: periods.map((period) => {
        const list = rows.filter((r) => r.period === period);
        return {
          period,
          label: monthLabel(period),
          count: list.length,
          outTiyin: list.filter((r) => r.dir === 'OUT').reduce((s, r) => s + big(r.amountTiyin), 0n).toString(),
          inTiyin: list.filter((r) => r.dir === 'IN').reduce((s, r) => s + big(r.amountTiyin), 0n).toString(),
        };
      }),
      rows,
      invalid: invalid.map((x) => ({ rowIndex: x.row, reason: x.reason })).slice(0, 50),
      invalidCount: invalid.length,
      /** O'z-o'zini tekshirish: faktura jami va qator summalari (bank ko'chirmasidagi «checks» dan boshqa shakl) */
      invoiceChecks: checks,
      checks: null,
      groups: this.groups(rows.map((r) => ({ ...r, account: '' })), periods, new Map(), true, store.groups),
    };
  }

  /** Saqlash: fayldagi fakturalar ID bo'yicha yangilanadi (boshqalarga tegilmaydi) */
  override async commit(body: { fileName?: unknown; rows?: unknown; allIds?: unknown; org?: unknown; months?: unknown; account?: unknown }, userId: string) {
    if (!Array.isArray(body?.rows) || !body.rows.length) throw new BadRequestException("Ma'lumot yo'q");
    if (body.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'fakturalar.xlsx';
    const o = (body.org && typeof body.org === 'object' ? body.org : {}) as { inn?: unknown; name?: unknown };
    const orgInn = typeof o.inn === 'string' && /^\d{9}$/.test(o.inn) ? o.inn : null;
    if (!orgInn) throw new BadRequestException("Bizning korxona INN'i (9 raqam) kerak");
    const months = Array.isArray(body.months) && body.months.length ? new Set(body.months.map(String)) : null;
    const counters = new Map<string, number>();
    const rows: InvoiceRow[] = [];
    for (const raw of body.rows as Record<string, unknown>[]) {
      const docDate = invoiceDate(raw?.docDate);
      if (!docDate) throw new BadRequestException(`Sana noto'g'ri: ${cap(raw?.docDate, 20)}`);
      const dir: BankDir | null = raw?.dir === 'IN' ? 'IN' : raw?.dir === 'OUT' ? 'OUT' : null;
      if (!dir) throw new BadRequestException("Yo'nalish noto'g'ri");
      const invoiceId = cap(raw.invoiceId, 64);
      if (!invoiceId) throw new BadRequestException("Faktura ID yo'q");
      const amount = big(cap(raw.amountTiyin, 20));
      if (amount <= 0n) throw new BadRequestException(`Summa noto'g'ri: ${cap(raw.docNo, 30)}`);
      const status = cap(raw.status, 40);
      if (!(INVOICE_STATUSES as readonly string[]).includes(status)) throw new BadRequestException(`Holat «${status}» — olinmaydi`);
      const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(raw.period ?? '')) ? String(raw.period) : docDate.slice(0, 7);
      if (months && !months.has(period)) continue;
      const idx = counters.get(invoiceId) ?? 0;
      counters.set(invoiceId, idx + 1);
      const item = { no: cap(raw.itemNo, 10), ikpu: cap(raw.ikpu, 300), totalTiyin: amount.toString(), name: '', unit: '', qty: null, priceTiyin: '0', costTiyin: '0', vatRate: null, vatTiyin: '0' };
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      rows.push({
        id: itemId(invoiceId, item, idx),
        invoiceId,
        itemNo: item.no,
        docDate,
        procDate: null,
        docNo: cap(raw.docNo, 60),
        accountName: cap(raw.accountName, 300),
        inn: cap(raw.inn, 14).replace(/\D/g, ''),
        mfo: '',
        dir,
        amountTiyin: amount.toString(),
        purpose: cap(raw.purpose, 500),
        status,
        docType: cap(raw.docType, 60),
        contract: cap(raw.contract, 120),
        contractDate: invoiceDate(raw.contractDate),
        ikpu: item.ikpu,
        unit: cap(raw.unit, 60),
        qty: num(raw.qty),
        priceTiyin: big(cap(raw.priceTiyin, 20)).toString(),
        costTiyin: big(cap(raw.costTiyin, 20)).toString(),
        vatTiyin: big(cap(raw.vatTiyin, 20)).toString(),
        vatRate: num(raw.vatRate),
        period,
        invoiceNote: cap(raw.invoiceNote, 500),
        ourBranch: cap(raw.ourBranch, 200),
      });
    }
    if (!rows.length) throw new BadRequestException("Tanlangan oylarda qator yo'q");
    const allIds = new Set<string>(Array.isArray(body.allIds) ? body.allIds.map((x) => String(x).slice(0, 64)).slice(0, 200000) : []);
    for (const r of rows) allIds.add(r.invoiceId);
    const user = await this.userName(userId);
    const batchId = randomUUID();
    const now = new Date().toISOString();
    const result = await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const acc = (store.accounts[ACCOUNT] ??= { key: ACCOUNT, label: ACCOUNT_LABEL, months: {} });
      let removed = 0;
      const updated = new Set<string>();
      for (const [p, m] of Object.entries(acc.months)) {
        const keep = m.rows.filter((r) => !allIds.has((r as InvoiceRow).invoiceId));
        for (const r of m.rows) if (allIds.has((r as InvoiceRow).invoiceId)) updated.add((r as InvoiceRow).invoiceId);
        removed += m.rows.length - keep.length;
        m.rows = keep;
        if (!keep.length) delete acc.months[p];
      }
      for (const r of rows) {
        const p = r.docDate.slice(0, 7);
        const m = (acc.months[p] ??= { batchId, fileName, savedAt: now, uploadedBy: user, rows: [] });
        m.batchId = batchId;
        m.fileName = fileName;
        m.savedAt = now;
        m.uploadedBy = user;
        m.rows.push({ ...r, batchId } as InvoiceRow);
      }
      const outT = rows.filter((r) => r.dir === 'OUT').reduce((s, r) => s + big(r.amountTiyin), 0n);
      const inT = rows.filter((r) => r.dir === 'IN').reduce((s, r) => s + big(r.amountTiyin), 0n);
      const docMonths = [...new Set(rows.map((r) => r.period))].sort();
      store.batches.push({ id: batchId, account: ACCOUNT, accountLabel: ACCOUNT_LABEL, fileName, createdAt: now, uploadedBy: user, months: docMonths, rows: rows.length, outTiyin: outT.toString(), inTiyin: inT.toString(), status: 'COMMITTED', cancelledAt: null });
      if (store.batches.length > 300) store.batches = store.batches.slice(-300);
      const dropped = await this.prisma.$transaction(async (tx) => {
        const n = await this.dropOrphans(store, tx, "faktura qayta yuklandi — bu qator yangi faylda yo'q (yoki holati o'zgargan)");
        await this.save(store, tx);
        const org = { inn: orgInn, name: typeof o.name === 'string' ? o.name.slice(0, 300) : '' } as object;
        await tx.setting.upsert({ where: { key: ORG_KEY }, create: { key: ORG_KEY, value: org }, update: { value: org } });
        return n;
      });
      return { removed, updated: updated.size, outT, inT, dropped, months: docMonths };
    });
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: this.entity,
      entityId: batchId,
      summary: `Schyot-faktura tahlili: ${fileName} — ${new Set(rows.map((r) => r.invoiceId)).size} ta faktura, ${rows.length} qator${result.updated ? `, ${result.updated} tasi yangilandi` : ''}${result.dropped ? `, ${result.dropped} ta yo'naltirish bekor qilindi` : ''}`,
    });
    return { success: true as const, batchId, account: ACCOUNT, months: result.months, saved: rows.length, invoices: new Set(rows.map((r) => r.invoiceId)).size, updatedInvoices: result.updated, removedRows: result.removed, replacedMonths: [] as string[], outTiyin: result.outT.toString(), inTiyin: result.inT.toString(), droppedPosts: result.dropped };
  }

  override async batches() {
    const store = await this.store();
    const live = new Map<string, number>();
    for (const m of Object.values(store.accounts[ACCOUNT]?.months ?? {})) for (const r of m.rows) live.set((r as InvoiceRow).batchId ?? '', (live.get((r as InvoiceRow).batchId ?? '') ?? 0) + 1);
    return [...store.batches].reverse().map((b) => {
      const n = live.get(b.id) ?? 0;
      return { ...b, liveMonths: n ? b.months : [], liveRows: n, state: b.status === 'CANCELLED' ? 'CANCELLED' : n === b.rows ? 'ACTIVE' : n ? 'PARTIAL' : 'REPLACED' };
    });
  }

  /** Yuklashni bekor qilish: shu yuklashdan qolgan qatorlar olib tashlanadi (oldingi nusxasi tiklanmaydi) */
  override async cancel(id: string, userId: string) {
    const out = await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const b = store.batches.find((x) => x.id === id);
      if (!b) throw new NotFoundException('Yuklash topilmadi');
      if (b.status === 'CANCELLED') throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
      const acc = store.accounts[ACCOUNT];
      let removed = 0;
      for (const [p, m] of Object.entries(acc?.months ?? {})) {
        const keep = m.rows.filter((r) => (r as InvoiceRow).batchId !== id);
        removed += m.rows.length - keep.length;
        m.rows = keep;
        if (!keep.length) delete acc!.months[p];
      }
      b.status = 'CANCELLED';
      b.cancelledAt = new Date().toISOString();
      const dropped = await this.prisma.$transaction(async (tx) => {
        const n = await this.dropOrphans(store, tx, 'faktura yuklashi bekor qilindi');
        await this.save(store, tx);
        return n;
      });
      return { removed, b, dropped };
    });
    await this.audit.log({ userId, action: 'DELETE', entity: this.entity, entityId: id, summary: `Schyot-faktura yuklashi bekor qilindi: ${out.b.fileName} (${out.removed} qator)${out.dropped ? `; ${out.dropped} ta yo'naltirilgan yozuv o'chirildi` : ''}` });
    return { success: true as const, months: out.b.months, removedRows: out.removed, droppedPosts: out.dropped };
  }

  /** Bizning korxona (INN) — fayldan aniqlangan yoki saqlangan */
  async orgInfo() {
    return { org: await this.org(), statuses: [...INVOICE_STATUSES] };
  }
}
