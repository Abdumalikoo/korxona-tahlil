import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { renderExcel } from './render.excel';
import { renderPdf } from './render.pdf';
import { renderPptx } from './render.pptx';
import { AssetsReport } from './report.assets';
import { ControlsReport } from './report.controls';
import { ExecutiveReport } from './report.executive';
import { ExpensesReport } from './report.expenses';
import { IncomesReport } from './report.incomes';
import { ModelsReport } from './report.models';
import { PayrollReport } from './report.payroll';
import { FinancialReport } from './report.financial';
import { PassportReport } from './report.passport';
import { ReactionsSummaryReport } from './report.reactions';
import { RegionsReport } from './report.regions';
import { SolishtirmaReport } from './report.solishtirma';
import { formulasFor } from './reports.formulas';
import { addWorkings } from './reports.workings';
import { FORMAT_INFO, forFormat, type CatalogItem, type GenerateInput, type HistoryItem, type ReportDoc, type ReportFormat, type ReportParams } from './reports.types';

/** Tarixda saqlanadigan eng ko'p hisobotlar soni (eskilari o'chadi) */
const KEEP = 300;
const FORMATS: ReportFormat[] = ['xlsx', 'pptx', 'pdf'];

/** Hisobotlar ro'yxati — har bir qadamda yangilari qo'shiladi */
export const CATALOG: CatalogItem[] = [
  {
    id: 'executive',
    title: 'Umumiy hisobot',
    description: "Rahbar uchun 2–3 sahifada: davr natijasi, reja bajarilishi, natija nimaga o'zgardi, hududlar va Markaz, xavflar va tavsiyalar, ma'lumot va prognoz ishonchliligi.",
    contents: [
      "Rahbariyat xulosasi: fakt, reja va prognoz alohida",
      "Reja–fakt va davrlar taqqoslash (o'tgan teng davr, o'tgan yil)",
      "Natija o'zgarishining sabablari (xizmat turlari va xarajat moddalari)",
      'Hududlar: natija, rentabellik, bir xodimga, reja bajarilishi; Markazni qoplash',
      "Xavflar va ustuvor tavsiyalar (mas'ul va muddat bilan)",
      "Ma'lumot to'liqligi, prognoz ishonchliligi va metodika",
    ],
    unit: 'none',
    period: true,
    formats: FORMATS,
    group: 'Rahbariyat',
    options: [
      { key: 'compare', label: 'Taqqoslash', default: 'yoy', choices: [{ value: 'yoy', label: "O'tgan yilning shu davri" }, { value: 'prev', label: "O'tgan teng davr" }] },
      { key: 'view', label: "Ko'rinish", default: 'short', choices: [{ value: 'short', label: 'Qisqa' }, { value: 'full', label: "To'liq" }] },
    ],
  },
  {
    id: 'financial',
    title: 'Davr moliyaviy hisoboti',
    description: "Daromad, xarajat va natija — o'tgan teng davr va o'tgan yilning shu davri bilan solishtirib; oylar, tarkib va hududlar bo'yicha.",
    contents: ["Asosiy ko'rsatkichlar va davrlar solishtirmasi", "Oylar bo'yicha daromad, xarajat, natija", 'Daromad tarkibi (xizmat turlari)', 'Xarajat tarkibi (guruhlar va eng katta moddalar)', 'Hududlar (butun korxona tanlanganda)', 'Xulosalar'],
    unit: 'optional',
    period: true,
    formats: FORMATS,
    group: 'Moliya',
  },
  {
    id: 'regions',
    title: 'Hududlar solishtirmasi',
    description: "Barcha hududlar va Markaz: daromad, xarajat, natija, bir xodimga ko'rsatkichlar, xarajat tarkibi va oylar bo'yicha natija.",
    contents: ["Umumiy ko'rinish va Markazni qoplash", 'Hududlar jadvali (natija, rentabellik, xodimlar)', "Bir xodimga daromad va xarajat", 'Xarajat tarkibi (ish haqi, ijara, mashinalar)', "Oylar bo'yicha natija va zararli oylar", 'Xulosalar'],
    unit: 'none',
    period: true,
    formats: FORMATS,
    group: 'Hududlar',
  },
  {
    id: 'solishtirma',
    title: "Solishtirma — to'liq hisobot",
    description: "Solishtirma bo'limidagi barcha ma'lumot bitta Excel faylida, ichma-ich: hududlar → tumanlar → xizmatlar, xarajat moddalari va xodimlar; Markaz → bo'limlar; sohalar kesimida nima daromad, nima xarajat.",
    contents: [
      "Hududlar → tumanlar → xizmatlar, moddalar, xodimlar (ichma-ich, [+] bilan ochiladi)",
      "Markaz → bo'limlar → moddalar va xodimlar; hududlar uchun to'langan",
      'Sohalar: xizmat turlari → hududlar → tumanlar; modda guruhlari → moddalar → hududlar',
      'Daromad va xarajat matritsalari (soha × hudud)',
      "Tumanlar, xizmatlar, xarajat tarkibi, xodimlar va xodimlar oylari — filtrli ro'yxatlar",
      'Oylar dinamikasi, biriktirilmagan yozuvlar, xodimlar harakati, tekshiruv va metodika',
    ],
    unit: 'none',
    period: true,
    formats: ['xlsx'],
    group: 'Hududlar',
    options: [
      { key: 'compare', label: 'Taqqoslash', default: 'prev', choices: [{ value: 'prev', label: "O'tgan teng davr" }, { value: 'yoy', label: "O'tgan yilning shu davri" }] },
      { key: 'section', label: 'Yozuvlar', default: 'ALL', choices: [{ value: 'ALL', label: 'Hammasi' }, { value: 'DOIMIY', label: 'Doimiy' }, { value: 'BOSHQA', label: 'Bir martalik' }] },
    ],
  },
  {
    id: 'passport',
    title: 'Hudud pasporti',
    description: "Bitta hudud yoki Markaz bo'yicha hammasi: ko'rsatkichlar, boshqa hududlar orasidagi o'rni, tarkib, xodimlar, prognoz, samaradorlik, risk, munosabat va nazorat.",
    contents: ["Asosiy ko'rsatkichlar va solishtirish", "Hududlar orasidagi o'rni", "Oylar bo'yicha", 'Daromad va xarajat tarkibi', 'Xodimlar (lavozimlar, kirgan va bo\'shaganlar)', 'Prognoz, samaradorlik, zararsizlik, risk', 'Munosabat va nazorat', 'Xulosalar'],
    unit: 'required',
    period: true,
    formats: FORMATS,
    group: 'Hududlar',
  },
  {
    id: 'expenses',
    title: 'Xarajatlar tarkibi',
    description: "Xarajatlar guruhlar va moddalar bo'yicha (daraxt), oylar, eng ko'p o'zgarganlar, kontragentlar, eng katta yozuvlar va to'lov holati.",
    contents: ["Guruhlar va moddalar — o'tgan davr bilan", "Oylar bo'yicha (guruhlar)", "Eng ko'p ko'paygan va kamaygan moddalar", 'Kontragentlar (eng katta 20 ta)', 'Eng katta yozuvlar', "To'lov holati va hududlar"],
    unit: 'optional',
    period: true,
    formats: FORMATS,
    group: 'Tarkib',
  },
  {
    id: 'incomes',
    title: 'Daromadlar tarkibi',
    description: "Xizmat turlari, oylar, mijozlar va ularga bog'liqlik darajasi, to'lanmagan daromad (debitorlik), hududlar × xizmatlar.",
    contents: ['Xizmat turlari: summa, soni, o\'rtacha', "Oylar bo'yicha (xizmat turlari)", 'Mijozlar: eng kattalari, yangilari, ketganlari, konsentratsiya', "To'lov holati va eng katta qarzlar", 'Hududlar va xizmatlar'],
    unit: 'optional',
    period: true,
    formats: FORMATS,
    group: 'Tarkib',
  },
  {
    id: 'payroll',
    title: 'Ish haqi va xodimlar',
    description: "Ish haqi xarajati (Xarajatlar bo'limidan) va xodimlar (Xodimlar bo'limidan): oylar, hududlar, bir xodimga, kadrlar harakati, takrorlangan to'lovlar tekshiruvi.",
    contents: ["Ish haqi, xodimlar soni, bir xodimga", "Oylar bo'yicha (g'ayrioddiy oylar belgilangan)", "Hududlar: 1 so'm ish haqiga daromad", 'Kirgan va bo\'shaganlar, lavozimlar', "Ma'lumot sifati"],
    unit: 'optional',
    period: true,
    formats: FORMATS,
    group: 'Tarkib',
  },
  {
    id: 'assets',
    title: 'Mashinalar va ijara',
    description: "Har bir mashina bo'yicha xarajat, yoqilg'i (litr, narx, me'yor), ta'mir; ijara shartnomalari, maydon, 1 m² narxi, tugayotgan shartnomalar.",
    contents: ["Oylar bo'yicha mashina va ijara xarajati", "Mashinalar: yoqilg'i, ta'mir, probeg, sarf", 'Ijara shartnomalari va hududlar', 'Tugayotgan shartnomalar'],
    unit: 'optional',
    period: true,
    formats: FORMATS,
    group: 'Tarkib',
  },
  {
    id: 'reactions',
    title: 'Munosabatlar hisoboti',
    description: "Davrdagi barcha munosabatlar yig'masi yoki bitta munosabat bo'yicha batafsil: moddalar, baza bilan solishtirish, ta'sir, muddatlar va mas'ullar.",
    contents: ["Holat: ochiq, muddati o'tgan, nazoratda, yopilgan", "Har bir munosabat: moddalar, o'zgarish va natijaga ta'siri", "Mas'ullar kesimida", "Bitta munosabat: oylar bo'yicha va yirik yozuvlar", 'Xulosa va tavsiyalar'],
    unit: 'none',
    period: true,
    formats: FORMATS,
    group: 'Munosabat va Nazorat',
    subject: { kind: 'reaction', label: 'Munosabat', emptyLabel: "Barchasi (yig'ma)" },
  },
  {
    id: 'controls',
    title: 'Nazorat hisoboti',
    description: "Nazoratdagi moddalar: joriy holat, davr oylarida chegara bilan solishtirish, buzilishlar ro'yxati va keyingi 3 oy prognozi (buzish ehtimoli).",
    contents: ["Buzilgan, xavf ostida va me'yordagi moddalar", "Oylar bo'yicha qiymat va chegara", "Buzilishlar: oy, summa, farq", 'Prognoz: keyingi 3 oy va buzish ehtimoli', 'Xulosa va tavsiyalar'],
    unit: 'optional',
    period: true,
    formats: FORMATS,
    group: 'Munosabat va Nazorat',
  },
  {
    id: 'models',
    title: 'Katta modellar hisoboti',
    description: "Prognoz (yil yakuni bilan), hududlar prognozi, omillar (panel regressiya), samaradorlik (DEA), zararsizlik va risk — barcha modellar bir hujjatda.",
    contents: ["Yil yakuni: haqiqiy + prognoz", "Oylar bo'yicha prognoz va model aniqligi", 'Hududlar: keyingi 3 oy', "Omillar: daromad nimaga bog'liq", 'Samaradorlik, zararsizlik, risk', "Manba ma'lumot va usullar"],
    unit: 'none',
    period: false,
    formats: FORMATS,
    group: 'Katta modellar',
  },
];

/** Ekranda bitta jadvalda ko'pi bilan shuncha qator (to'liq ro'yxat — Excel faylida) */
const SCREEN_ROWS = 400;

/** Ekran uchun: juda katta jadvallar qisqartiriladi (fayllarda — to'liq) */
function trimForScreen(doc: ReportDoc): ReportDoc {
  return {
    ...doc,
    sections: doc.sections.map((s) => ({
      ...s,
      blocks: s.blocks.map((b) => {
        if (b.type !== 'table' || b.rows.length <= SCREEN_ROWS) return b;
        // Ichma-ich jadvalda yuqori ikki daraja doim qoladi (tuzilma buzilmasin), chuqurroqlari — chegaragacha
        const levels = b.levels && b.levels.length === b.rows.length ? b.levels : null;
        const keep: number[] = [];
        b.rows.forEach((_, i) => {
          if ((levels && (levels[i] ?? 0) <= 1) || keep.length < SCREEN_ROWS) keep.push(i);
        });
        const pick = <T,>(list: T[] | undefined) => (list ? keep.map((i) => list[i] as T) : undefined);
        const note = `Ekranda ${keep.length} ta qator ko'rsatildi (jami ${b.rows.length} ta) — to'liq ro'yxat Excel faylida.`;
        return {
          ...b,
          rows: pick(b.rows)!,
          ...(levels ? { levels: pick(levels) } : {}),
          ...(b.marks ? { marks: pick(b.marks) } : {}),
          ...(b.rowTone ? { rowTone: pick(b.rowTone) } : {}),
          note: b.note ? `${b.note} ${note}` : note,
        };
      }),
    })),
  };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialReport,
    private readonly executive: ExecutiveReport,
    private readonly regions: RegionsReport,
    private readonly passport: PassportReport,
    private readonly expenses: ExpensesReport,
    private readonly incomes: IncomesReport,
    private readonly payroll: PayrollReport,
    private readonly assets: AssetsReport,
    private readonly reactionsReport: ReactionsSummaryReport,
    private readonly controlsReport: ControlsReport,
    private readonly models: ModelsReport,
    private readonly solishtirma: SolishtirmaReport,
  ) {}

  catalog(): CatalogItem[] {
    return CATALOG;
  }

  private async build(type: string, params: ReportParams): Promise<ReportDoc> {
    switch (type) {
      case 'financial':
        return this.financial.build(params);
      case 'executive':
        return this.executive.build(params);
      case 'regions':
        return this.regions.build(params);
      case 'solishtirma':
        return this.solishtirma.build(params);
      case 'passport':
        return this.passport.build(params);
      case 'expenses':
        return this.expenses.build(params);
      case 'incomes':
        return this.incomes.build(params);
      case 'payroll':
        return this.payroll.build(params);
      case 'assets':
        return this.assets.build(params);
      case 'reactions':
        return this.reactionsReport.build(params);
      case 'controls':
        return this.controlsReport.build(params);
      case 'models':
        return this.models.build();
      default:
        throw new NotFoundException(`Hisobot turi topilmadi: ${type}`);
    }
  }

  /**
   * Hujjatni to'liq tayyorlash: hisobot + har bir jadval ostida hisob-kitoblar (raqamlar bilan)
   * + oxirida hisoblash formulalari. appendix — har bir qatorning hisob-kitobi (PDF va ekran uchun).
   */
  private async prepare(input: GenerateInput, withAppendix: boolean): Promise<{ type: string; params: ReportParams; doc: ReportDoc }> {
    const type = String(input?.type ?? '');
    const item = CATALOG.find((c) => c.id === type);
    if (!item) throw new NotFoundException('Hisobot turi topilmadi');
    const params: ReportParams = {
      from: String(input?.from ?? ''),
      to: String(input?.to ?? ''),
      ...(input?.unit ? { unit: String(input.unit) } : {}),
      ...(input?.subject ? { subject: String(input.subject) } : {}),
    };
    // Sozlamalar: faqat katalogda e'lon qilinganlari va ruxsat etilgan qiymatlar (aks holda — standart)
    if (item.options?.length) {
      const raw = (input?.options ?? {}) as Record<string, unknown>;
      params.options = Object.fromEntries(
        item.options.map((o) => {
          const v = String(raw[o.key] ?? '');
          return [o.key, o.choices.some((c) => c.value === v) ? v : o.default];
        }),
      );
    }
    if (item.unit === 'none') delete params.unit;
    if (!item.subject) delete params.subject;
    if (!item.period) {
      params.from = '';
      params.to = '';
    }

    const doc = await this.build(type, params);
    // O'z metodikasi bor hisobot (Umumiy hisobot) — umumiy ilova va formulalar qo'shilmaydi
    if (doc.ownMethodology) return { type, params, doc };
    // Har bir jadval ostida — hisob-kitob hisobotning o'z raqamlari bilan
    const appendix = addWorkings(doc);
    if (withAppendix && appendix) doc.sections.push(appendix);
    // Har bir hisobot oxirida — hisoblash formulalari (ko'rsatkichlar qanday hisoblangani)
    const formulas = formulasFor(type);
    if (formulas.length) {
      doc.sections.push({
        title: 'Hisoblash formulalari',
        intro: "Hisobotdagi ko'rsatkichlar qanday hisoblangani. Excel faylida jami, natija, o'zgarish, ulush va bir xodimga ustunlari jonli formulalar bilan yozilgan.",
        blocks: [{ type: 'formulas', items: formulas }],
      });
    }
    return { type, params, doc };
  }

  /** Ekranda ko'rish uchun: hujjat JSON ko'rinishida (fayl yaratilmaydi, tarixga yozilmaydi) */
  async preview(input: GenerateInput): Promise<ReportDoc> {
    return trimForScreen((await this.prepare(input, true)).doc);
  }

  async generate(input: GenerateInput, userId: string | null): Promise<{ buffer: Buffer; filename: string; mime: string; id: string }> {
    const item = CATALOG.find((c) => c.id === String(input?.type ?? ''));
    if (!item) throw new NotFoundException('Hisobot turi topilmadi');
    const format = String(input?.format ?? 'xlsx') as ReportFormat;
    if (!item.formats.includes(format)) throw new BadRequestException("Format noto'g'ri: xlsx, pptx yoki pdf");
    // Ilova (har bir qator hisob-kitobi) — PDF da; Excel da o'rniga jonli formulalar, slaydlarda — asosiylari
    const { type, params, doc: full } = await this.prepare(input, format === 'pdf');
    // Formatga ko'ra: batafsil jadvallar — Excel'da, grafiklar — PDF/PowerPoint'da (raqamlar bitta hujjatdan)
    const doc = forFormat(full, format);
    const buffer = format === 'xlsx' ? await renderExcel(doc) : format === 'pptx' ? await renderPptx(doc) : await renderPdf(doc);
    const filename = `${doc.fileBase}.${FORMAT_INFO[format].ext}`;

    const run = await this.prisma.reportRun.create({
      data: {
        type,
        title: doc.title,
        format,
        filename,
        size: buffer.length,
        params: { ...params, subtitle: doc.subtitle } as Prisma.InputJsonValue,
        content: new Uint8Array(buffer),
        createdById: userId,
      },
      select: { id: true },
    });
    await this.trim();
    return { buffer, filename, mime: FORMAT_INFO[format].mime, id: run.id };
  }

  /** Eski hisobotlarni tozalash */
  private async trim() {
    const old = await this.prisma.reportRun.findMany({ orderBy: { createdAt: 'desc' }, skip: KEEP, select: { id: true } });
    if (old.length) await this.prisma.reportRun.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }

  async history(limit = 50): Promise<HistoryItem[]> {
    const take = Math.min(200, Math.max(1, Number(limit) || 50));
    const runs = await this.prisma.reportRun.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, type: true, title: true, format: true, filename: true, size: true, params: true, createdAt: true, createdById: true },
    });
    const ids = [...new Set(runs.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return runs.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      format: r.format as ReportFormat,
      filename: r.filename,
      size: r.size,
      params: r.params as unknown as ReportParams,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdById ? (name.get(r.createdById) ?? null) : null,
    }));
  }

  async file(id: string): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const run = await this.prisma.reportRun.findUnique({ where: { id }, select: { content: true, filename: true, format: true } });
    if (!run) throw new NotFoundException('Hisobot topilmadi');
    return { buffer: Buffer.from(run.content), filename: run.filename, mime: FORMAT_INFO[run.format as ReportFormat]?.mime ?? 'application/octet-stream' };
  }

  async remove(id: string): Promise<void> {
    const found = await this.prisma.reportRun.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Hisobot topilmadi');
    await this.prisma.reportRun.delete({ where: { id } });
  }
}