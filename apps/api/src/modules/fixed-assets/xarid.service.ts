import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { runExclusive } from '../../common/locks';
import { buildTemplate, parseWithTemplate } from '../../common/templates/sheet-template';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  amountsOf,
  classify,
  methodOf,
  platformOf,
  rowKeys,
  statusOf,
  unitOf,
  XARID_KIND_LABEL,
  XARID_KINDS,
  XARID_SPEC,
  XARID_STATUS_LABEL,
  type XaridKind,
  type XaridRaw,
  type XaridStatus,
} from './xarid.classify';

// ═══════════════════════════════════════════════════════════
// Asosiy vositalar › Xarid shabloni (1-bosqich — faqat reestr: hech bir raqamga ta'sir qilmaydi).
// Fayl umumiy shablon tizimi bilan o'qiladi va settings jadvalida saqlanadi (migratsiyasiz):
//   asset.xarid      — oxirgi yuklangan fayl: qatorlar (o'qilgan qiymatlar), varaq, sarlavha qatori
//   asset.xarid.rule — filtr qoidasi: asosiy vosita chegarasi (1 dona, so'm) va qo'lda belgilangan turlar
// Ko'rinish har safar joriy qoida bilan qayta hisoblanadi (chegara o'zgarsa — turlar ham o'zgaradi).
// ═══════════════════════════════════════════════════════════

const STORE_KEY = 'asset.xarid';
const RULE_KEY = 'asset.xarid.rule';
const DEFAULT_MIN_SOM = 5_000_000;
const MAX_ROWS = 5000;

interface XaridStore {
  fileName: string;
  savedAt: string;
  savedBy: string;
  sheet: string;
  headerRow: number;
  missing: string[];
  skipped: number;
  rows: XaridRaw[];
}

interface XaridRule {
  assetMinSom: number;
  overrides: Record<string, XaridKind>;
}

const tiyin = (som: number | null) => (som === null ? null : BigInt(Math.round(som * 100)).toString());
const txt = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

@Injectable()
export class XaridService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async readRule(): Promise<XaridRule> {
    const v = (await this.prisma.setting.findUnique({ where: { key: RULE_KEY } }))?.value as Partial<XaridRule> | null;
    const min = Number(v?.assetMinSom);
    const overrides: Record<string, XaridKind> = {};
    for (const [k, kind] of Object.entries(v?.overrides ?? {})) if ((XARID_KINDS as readonly string[]).includes(kind)) overrides[k] = kind;
    return { assetMinSom: Number.isFinite(min) && min >= 0 ? min : DEFAULT_MIN_SOM, overrides };
  }

  private async readStore(): Promise<XaridStore | null> {
    const v = (await this.prisma.setting.findUnique({ where: { key: STORE_KEY } }))?.value as unknown as XaridStore | null;
    return v && typeof v === 'object' && Array.isArray(v.rows) ? v : null;
  }

  private async userName(userId: string) {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
  }

  private async parse(file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    await assertSafeXlsx(file.buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang");
    }
    const parsed = parseWithTemplate(wb, XARID_SPEC);
    if (!parsed) throw new BadRequestException("Sarlavha topilmadi: «Товар (иш, хизмат) номи» ustuni bo'lishi kerak — shablonni yuklab oling");
    if (parsed.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p (${parsed.rows.length}) — ${MAX_ROWS} tagacha`);
    // Mas'ul xodim ustuni shablonda yo'q — o'qilmaydi
    return { fileName: String(file.originalname ?? 'xarid.xlsx').slice(0, 200), sheet: parsed.sheet, headerRow: parsed.headerRow, missing: parsed.missing, skipped: parsed.skipped, rows: rowKeys(parsed.rows) };
  }

  /** Qatorlar joriy qoida bilan: tur, holat, birlik, summa (tiyin), ogohlantirishlar va jamlanmalar */
  private present(rows: XaridRaw[], rule: XaridRule) {
    const list = rows.map((r) => {
      const v = r.values;
      const a = amountsOf(v);
      const auto = classify(v, a.unitPrice, rule.assetMinSom);
      const status = statusOf(v.note, Boolean(typeof v.contractTotal === 'number' && v.contractTotal > 0));
      const override = rule.overrides[r.key] ?? null;
      const warnings = [...r.warnings, ...a.warnings];
      if (status === 'DONE' && !v.invoiceNo) warnings.push("Bajarilgan, lekin schyot-faktura raqami yo'q");
      if (status === 'DONE' && a.total === null) warnings.push("Bajarilgan, lekin «Шартнома / жами сумма» bo'sh — summa hisobga olinmadi");
      const platformText = txt(v.platform);
      return {
        key: r.key,
        row: r.row,
        name: txt(v.name) ?? '',
        unit: unitOf(v.unit),
        structure: txt(v.unit),
        reqDept: txt(v.reqDept),
        reqNo: txt(v.reqNo),
        reqDate: txt(v.reqDate),
        purpose: txt(v.purpose),
        type: txt(v.type),
        measure: txt(v.measure),
        qty: a.qty,
        unitPriceTiyin: tiyin(a.unitPrice),
        totalTiyin: tiyin(a.total),
        /** Bozor taxminiy qiymati (shartnoma bo'lmasa) — jamiga qo'shilmaydi */
        estimateTiyin: tiyin(a.estimate),
        method: methodOf(v.method),
        platform: platformOf(platformText),
        platformUrl: platformText && /^https?:\/\//i.test(platformText.trim()) ? platformText.trim() : null,
        supplier: txt(v.supplier),
        contractNo: txt(v.contractNo),
        contractDate: txt(v.contractDate),
        invoiceNo: txt(v.invoiceNo),
        invoiceDate: txt(v.invoiceDate),
        status,
        kind: override ?? auto.kind,
        autoKind: auto.kind,
        reason: override ? `qo'lda belgilangan (filtr: ${XARID_KIND_LABEL[auto.kind].toLowerCase()} — ${auto.reason})` : auto.reason,
        overridden: Boolean(override),
        warnings,
      };
    });
    const done = list.filter((x) => x.status === 'DONE');
    const sumOf = (xs: typeof list) => xs.reduce((s, x) => s + BigInt(x.totalTiyin ?? '0'), 0n).toString();
    const group = <K extends string>(keyOf: (x: (typeof list)[number]) => K | null, xs = done) => {
      const m = new Map<K, typeof list>();
      for (const x of xs) {
        const k = keyOf(x);
        if (k === null) continue;
        m.set(k, [...(m.get(k) ?? []), x]);
      }
      return [...m.entries()].map(([key, items]) => ({ key, count: items.length, totalTiyin: sumOf(items) })).sort((a, b) => (BigInt(b.totalTiyin) > BigInt(a.totalTiyin) ? 1 : -1));
    };
    return {
      rule: { assetMinTiyin: tiyin(rule.assetMinSom)!, overrides: Object.keys(rule.overrides).length },
      kinds: XARID_KINDS.map((k) => ({ key: k, label: XARID_KIND_LABEL[k] })),
      statuses: (Object.keys(XARID_STATUS_LABEL) as XaridStatus[]).map((k) => ({ key: k, label: XARID_STATUS_LABEL[k], count: list.filter((x) => x.status === k).length })),
      summary: {
        rows: list.length,
        done: done.length,
        doneTotalTiyin: sumOf(done),
        warnings: list.filter((x) => x.warnings.length).length,
        byKind: XARID_KINDS.map((k) => {
          const items = done.filter((x) => x.kind === k);
          return { key: k, label: XARID_KIND_LABEL[k], count: items.length, totalTiyin: sumOf(items), all: list.filter((x) => x.kind === k).length };
        }),
        byUnit: group((x) => x.unit),
        byPlatform: group((x) => x.platform ?? x.method),
        byMonth: group((x) => (x.contractDate ?? x.invoiceDate)?.slice(0, 7) ?? null).sort((a, b) => a.key.localeCompare(b.key)),
      },
      rows: list,
    };
  }

  /** Saqlangan reestr (yo'q bo'lsa — loaded: false) */
  async view() {
    const [store, rule] = await Promise.all([this.readStore(), this.readRule()]);
    if (!store) return { loaded: false as const, ...this.present([], rule) };
    return { loaded: true as const, fileName: store.fileName, savedAt: store.savedAt, savedBy: store.savedBy, sheet: store.sheet, headerRow: store.headerRow, missing: store.missing, skipped: store.skipped, ...this.present(store.rows, rule) };
  }

  /** Faylni o'qish — hech narsa saqlanmaydi */
  async analyze(file: Express.Multer.File | undefined) {
    const p = await this.parse(file);
    const rule = await this.readRule();
    return { fileName: p.fileName, sheet: p.sheet, headerRow: p.headerRow, missing: p.missing, skipped: p.skipped, ...this.present(p.rows, rule) };
  }

  /** Saqlash (fayl qayta o'qiladi); avvalgi fayl almashtiriladi, qo'lda belgilangan turlar (qator kaliti bo'yicha) qoladi */
  async commit(file: Express.Multer.File | undefined, userId: string) {
    const p = await this.parse(file);
    const store: XaridStore = { fileName: p.fileName, savedAt: new Date().toISOString(), savedBy: await this.userName(userId), sheet: p.sheet, headerRow: p.headerRow, missing: p.missing, skipped: p.skipped.length, rows: p.rows };
    const value = store as unknown as object;
    await runExclusive(`setting:${STORE_KEY}`, () => this.prisma.setting.upsert({ where: { key: STORE_KEY }, create: { key: STORE_KEY, value }, update: { value } }));
    await this.audit.log({ userId, action: 'IMPORT', entity: 'asset_xarid', entityId: STORE_KEY, summary: `Asosiy vositalar xarid shabloni yuklandi: ${p.fileName} — «${p.sheet}» varag'i, ${p.rows.length} qator` });
    return { success: true as const, rows: p.rows.length };
  }

  /** Filtr qoidasi: asosiy vosita chegarasi (1 dona, so'm) */
  async setRule(body: { assetMinSom?: unknown }, userId: string) {
    const min = Number(String(body.assetMinSom ?? '').replace(/[\s ]/g, '').replace(',', '.'));
    if (!Number.isFinite(min) || min < 0 || min > 1e12) throw new BadRequestException("Chegara — 0 dan katta son (so'mda)");
    return runExclusive(`setting:${RULE_KEY}`, async () => {
      const rule = await this.readRule();
      const value = { ...rule, assetMinSom: Math.round(min) } as unknown as object;
      await this.prisma.setting.upsert({ where: { key: RULE_KEY }, create: { key: RULE_KEY, value }, update: { value } });
      await this.audit.log({ userId, action: 'UPDATE', entity: 'asset_xarid', entityId: RULE_KEY, summary: `Xarid filtri: asosiy vosita chegarasi ${rule.assetMinSom.toLocaleString('ru')} → ${Math.round(min).toLocaleString('ru')} so'm` });
      return { assetMinSom: Math.round(min) };
    });
  }

  /** Qatorning turini qo'lda belgilash (kind: null — filtrga qaytarish) */
  async setOverride(body: { key?: unknown; kind?: unknown }, userId: string) {
    const key = typeof body.key === 'string' ? body.key : '';
    const kind = body.kind === null || body.kind === '' ? null : String(body.kind);
    if (kind !== null && !(XARID_KINDS as readonly string[]).includes(kind)) throw new BadRequestException("Noma'lum tur");
    const store = await this.readStore();
    const row = store?.rows.find((r) => r.key === key);
    if (!row) throw new NotFoundException('Qator topilmadi — reestr qayta yuklangan bo\'lishi mumkin');
    return runExclusive(`setting:${RULE_KEY}`, async () => {
      const rule = await this.readRule();
      const overrides = { ...rule.overrides };
      if (kind === null) delete overrides[key];
      else overrides[key] = kind as XaridKind;
      const value = { ...rule, overrides } as unknown as object;
      await this.prisma.setting.upsert({ where: { key: RULE_KEY }, create: { key: RULE_KEY, value }, update: { value } });
      await this.audit.log({ userId, action: 'UPDATE', entity: 'asset_xarid', entityId: RULE_KEY, summary: `Xarid qatori (${row.row}-qator) turi: ${kind ? XARID_KIND_LABEL[kind as XaridKind] : 'filtr bo‘yicha'}` });
      return { key, kind };
    });
  }

  /** Yuklangan reestrni o'chirish (qoida va qo'lda belgilangan turlar qoladi) */
  async remove(userId: string) {
    const had = await this.readStore();
    if (!had) throw new NotFoundException('Xarid shabloni yuklanmagan');
    await runExclusive(`setting:${STORE_KEY}`, () => this.prisma.setting.delete({ where: { key: STORE_KEY } }));
    await this.audit.log({ userId, action: 'DELETE', entity: 'asset_xarid', entityId: STORE_KEY, summary: `Asosiy vositalar xarid shabloni o'chirildi: ${had.fileName}` });
    return { removed: true as const };
  }

  /** Bo'sh shablon — umumiy shablon tizimidan */
  async template(): Promise<{ buffer: Buffer; filename: string }> {
    return { buffer: await buildTemplate(XARID_SPEC), filename: 'asosiy-vositalar-xarid-shablon.xlsx' };
  }
}
