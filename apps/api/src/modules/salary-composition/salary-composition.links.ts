import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SourceArchiveService } from '../source-archive/source-archive.service';
import { CompositionPlaceService } from './salary-composition.place';
import { SalaryCompositionService } from './salary-composition.service';

// ═══════════════════════════════════════════════════════════
// Ish haqi tarkibi fayllari uchun «bog'liqliklar» (arxivdagi fayldan qo'shimcha ma'lumot):
//  • depts (v2) — tarkibdagi bo'lim ustuni → shu oy xodimlarning tarkibdagi bo'limi (Manbada | Ish haqi tarkibida).
// Yangi bog'liqlik kerak bo'lsa — shu yerga qo'shiladi: API ishga tushganda arxivdagi eski fayllarga ham o'zi qo'llanadi.
// ═══════════════════════════════════════════════════════════

@Injectable()
export class CompositionSourceLinks implements OnModuleInit {
  private readonly logger = new Logger(CompositionSourceLinks.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly composition: SalaryCompositionService,
    private readonly places: CompositionPlaceService,
    @Optional() private readonly archive?: SourceArchiveService,
  ) {}

  onModuleInit() {
    this.archive?.register({
      kind: 'salary-composition',
      name: 'depts',
      // v2: bo'lim ustuni sarlavhasi kengroq taniladi («Hudud», «Bo'lim nomi», «Hududi (bo'lim)» …)
      version: 2,
      label: "Tarkibdagi bo'limlar (xodim shu oy qaysi bo'limda)",
      run: async (entry, file) => {
        if (entry.unit) return { ok: true, note: "Bo'lim tarkibi — bo'lim ustuni kerak emas" };
        const period = entry.periods[0];
        if (!period || !entry.refId) return { ok: false, note: 'Oy yoki yuklash noma’lum' };
        const active = await this.prisma.salaryCompositionBatch.findFirst({ where: { period, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (active?.id !== entry.refId) return { ok: true, note: 'Bu tarkib almashtirilgan yoki bekor qilingan' };
        const v = await this.places.view(period);
        const have = v.departments.reduce((s, d) => s + d.count, 0);
        if (v.batchId === entry.refId && have > 0) return { ok: true, note: `Bo'limlar bog'langan: ${have} xodim` };
        const multer = { buffer: file.buffer, originalname: file.originalname, size: file.buffer.length } as Express.Multer.File;
        // Tahlildagi varaq; o'qilmasa — oy bo'yicha o'zi tanlaydi (yuklashdagidek)
        const data = entry.sheet ? await this.composition.analyze(period, multer, entry.sheet).catch(() => this.composition.analyze(period, multer)) : await this.composition.analyze(period, multer);
        if (!data.deptColumn) return { ok: true, note: "Faylda bo'lim ustuni yo'q" };
        const r = await this.places.attachDepts(period, data.rows.map((x) => ({ pinfl: x.pinfl, deptName: x.deptName ?? null })), data.deptColumn, entry.userId ?? 'system');
        this.logger.log(`Tarkib ${period}: arxivdagi fayldan bo'limlar bog'landi (${r.matched} xodim)`);
        return { ok: true, note: `Bo'limlar bog'landi: ${r.matched} xodim, ${r.departments} ta bo'lim («${r.column.label}» ustuni)` };
      },
    });
  }
}
