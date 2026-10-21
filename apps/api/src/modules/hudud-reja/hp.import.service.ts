import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { currentPeriodTashkent, KINDS, MAX_FILE_SIZE, periodAdd, type ImportKind } from './hp.const';
import { HpDataService } from './hp.data';
import { readWorkbook, type Issue, type ParsedRow } from './hp.import';
import { buildTemplate } from './hp.templates';

// ═══════════════════════════════════════════════════════════
// Import jarayoni: shablon → tekshirish (sessiya, bazaga yozilmaydi) → ko'rib chiqish → tasdiqlash (tranzaksiya).
// Kalit bo'yicha: yangi qator / mavjudni yangilash / o'zgarmagan. Siyosat: «upsert» yoki «faqat yangilar».
// Bazadagi yozuvlar hech qachon ommaviy o'chirilmaydi.
// ═══════════════════════════════════════════════════════════

type Status = 'new' | 'update' | 'same';
interface PayloadRow {
  row: number;
  key: string;
  status: Status;
  changes?: string[];
  values: Record<string, unknown>;
}

const KIND_SET = new Set<string>(['STATS', 'EMP_MONTHS', 'EMP_SERVICES', 'FACTORS', 'SERVICES']);
const ISSUE_LIMIT = 3000;

export function parseKind(raw: unknown, allowAll = false): ImportKind | 'ALL' {
  const k = String(raw ?? '').toUpperCase();
  if (allowAll && k === 'ALL') return 'ALL';
  if (!KIND_SET.has(k)) throw new BadRequestException("Ma'lumot turi noto'g'ri");
  return k as ImportKind;
}

const big = (v: unknown) => (v === null || v === undefined ? null : BigInt(v as number));
const eqNum = (a: unknown, b: unknown) => (a === null || a === undefined ? null : Number(a)) === (b === null || b === undefined ? null : Number(b));

@Injectable()
export class HpImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly data: HpDataService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── Shablonlar ─────────────────────────

  async template(kindRaw: unknown, fill: boolean) {
    const kind = parseKind(kindRaw, true);
    const [{ regions, services, tariffs }, employees] = await Promise.all([
      this.data.catalog(),
      this.prisma.employee.findMany({ where: { regionCode: { gt: 0 } }, select: { pinfl: true, fullName: true, regionCode: true, position: true, hiredAt: true, firedAt: true, isActive: true }, orderBy: [{ regionCode: 'asc' }, { fullName: 'asc' }] }),
    ]);
    const cur = currentPeriodTashkent();
    const ref = {
      regions,
      services: services.map((s) => {
        const t = [...tariffs].reverse().find((x) => x.service === s.code && x.region === null);
        return { code: s.code, label: s.label, isActive: s.isActive, tariffSom: t?.price ?? null, tariffFrom: t?.validFrom ?? null };
      }),
      employees: employees.map((e) => ({ pinfl: e.pinfl, fullName: e.fullName, regionCode: e.regionCode, position: e.position, hiredAt: e.hiredAt?.toISOString().slice(0, 10) ?? null, firedAt: e.firedAt?.toISOString().slice(0, 10) ?? null, isActive: e.isActive })),
      samplePeriod: periodAdd(cur, -1),
      fill: fill ? await this.fillRows(kind) : undefined,
    };
    return buildTemplate(kind, ref);
  }

  /** «Mavjud ma'lumot bilan» — yuklangan yozuvlar shablon ko'rinishida (tuzatib qayta yuklash uchun) */
  private async fillRows(kind: ImportKind | 'ALL') {
    const out: Partial<Record<ImportKind, Record<string, unknown>[]>> = {};
    const want = (k: ImportKind) => kind === 'ALL' || kind === k;
    const som = (v: bigint | null) => (v === null ? null : Number(v) / 100);
    if (want('STATS'))
      out.STATS = (await this.prisma.hpStat.findMany({ orderBy: [{ period: 'asc' }, { regionCode: 'asc' }, { serviceCode: 'asc' }], take: 60000 })).map((r) => ({
        oy: r.period, hudud_id: r.regionCode, xizmat_id: r.serviceCode, xizmat_soni: r.quantity, tarif: som(r.tariffTiyin), daromad_sum: som(r.revenueTiyin), reja_sum: som(r.planTiyin), manba_id: r.sourceRef, izoh: r.note,
      }));
    if (want('EMP_MONTHS'))
      out.EMP_MONTHS = (await this.prisma.hpEmpMonth.findMany({ orderBy: [{ period: 'asc' }, { employeePinfl: 'asc' }], take: 60000 })).map((r) => ({
        oy: r.period, xodim_id: r.employeePinfl, hudud_id: r.regionCode, ishlangan_kun: r.workedDays, ish_soati: r.workHours, ta_til_kun: r.vacationDays, jami_xizmat_soni: r.totalQuantity, jami_daromad_sum: som(r.totalRevenueTiyin), reja_sum: som(r.planTiyin), faol_holat: r.active ? 'ha' : "yo'q", izoh: r.note,
      }));
    if (want('EMP_SERVICES'))
      out.EMP_SERVICES = (await this.prisma.hpEmpService.findMany({ orderBy: [{ period: 'asc' }, { employeePinfl: 'asc' }], take: 60000 })).map((r) => ({
        oy: r.period, xodim_id: r.employeePinfl, hudud_id: r.regionCode, xizmat_id: r.serviceCode, xizmat_soni: r.quantity, tarif: som(r.tariffTiyin), daromad_sum: som(r.revenueTiyin), izoh: null,
      }));
    if (want('FACTORS'))
      out.FACTORS = (await this.prisma.hpRegionFactor.findMany({ orderBy: [{ period: 'asc' }, { regionCode: 'asc' }] })).map((r) => ({
        oy: r.period, hudud_id: r.regionCode, faol_tadbirkorlar_soni: r.activeEntrepreneurs, xodimlar_soni: r.employees, ish_kunlari: r.workDays, faol_xodimlar_soni: r.activeEmployees, izoh: r.note,
      }));
    return out;
  }

  // ───────────────────────── Tekshirish ─────────────────────────

  async check(file: Express.Multer.File | undefined, kindRaw: unknown, userId: string) {
    if (!file) throw new BadRequestException('Fayl tanlanmagan');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException(`Fayl hajmi ${Math.round(file.size / 1024 / 1024)} MB — ko'pi bilan ${MAX_FILE_SIZE / 1024 / 1024} MB`);
    const kind = parseKind(kindRaw, true);
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const refs = await this.data.refs();
    const parsed = await readWorkbook(file.buffer, fileName, kind, refs);
    const sessions = [];
    for (const sheet of parsed.sheets) {
      const payload = await this.diff(sheet.kind, sheet.rows);
      const issues: Issue[] = [...sheet.issues];
      if (sheet.kind === 'EMP_SERVICES') issues.push(...(await this.crossCheckEmployees(payload)));
      if (sheet.kind === 'STATS') issues.push(...(await this.crossCheckStats(payload)));
      const prev = await this.prisma.hpImport.findFirst({ where: { fileHash: parsed.fileHash, kind: sheet.kind, status: 'IMPORTED' }, orderBy: { importedAt: 'desc' } });
      if (prev) issues.unshift({ row: null, level: 'info', message: `Bu fayl ${prev.importedAt?.toISOString().slice(0, 10)} da allaqachon import qilingan — qayta tasdiqlansa dublikat yaratilmaydi` });
      if (parsed.ignored.length) issues.push({ row: null, level: 'info', message: `Tanilmagan varaqlar o'qilmadi: ${parsed.ignored.join(', ')}` });
      const counts = { new: 0, update: 0, same: 0 };
      for (const p of payload) counts[p.status] += 1;
      const periods = payload.map((p) => String(p.values.oy ?? '')).filter(Boolean).sort();
      const summary = {
        kind: sheet.kind,
        sheet: sheet.sheet,
        title: KINDS[sheet.kind].title,
        dataRows: sheet.dataRows,
        samples: sheet.samples,
        valid: payload.length,
        errorRows: sheet.errorRows.length,
        errors: issues.filter((i) => i.level === 'error').length,
        warnings: issues.filter((i) => i.level === 'warning').length,
        infos: issues.filter((i) => i.level === 'info').length,
        ...counts,
        from: periods[0] ?? null,
        to: periods[periods.length - 1] ?? null,
        regions: new Set(payload.map((p) => p.values.hudud_id).filter((x) => x !== undefined && x !== null)).size,
      };
      const session = await this.prisma.hpImport.create({
        data: {
          kind: sheet.kind,
          fileName,
          fileHash: parsed.fileHash,
          fileSize: file.size,
          status: 'CHECKED',
          summary,
          issues: issues.slice(0, ISSUE_LIMIT) as object,
          payload: payload as object,
          createdById: userId,
        },
      });
      sessions.push(this.view(session, true));
    }
    return { fileName, sessions };
  }

  /** Bazadagi mavjud yozuvlar bilan solishtirish: yangi / yangilanadi / o'zgarmagan */
  private async diff(kind: ImportKind, rows: ParsedRow[]): Promise<PayloadRow[]> {
    if (!rows.length) return [];
    const periods = [...new Set(rows.map((r) => String(r.values.oy ?? '')))].filter(Boolean);
    const out: PayloadRow[] = [];
    const cmp = (row: ParsedRow, existing: Record<string, unknown> | undefined, pairs: [string, string][]) => {
      if (!existing) return out.push({ row: row.row, key: row.key, status: 'new', values: row.values });
      const changes = pairs.filter(([col, field]) => !eqNum(typeof row.values[col] === 'boolean' ? Number(row.values[col]) : row.values[col], typeof existing[field] === 'boolean' ? Number(existing[field]) : existing[field])).map(([col]) => col);
      const textChanges = (['izoh', 'manba_id'] as const).filter((c) => c in row.values && (row.values[c] || null) !== ((existing[c === 'izoh' ? 'note' : 'sourceRef'] as string | null) || null));
      const all = [...changes, ...textChanges.filter((c) => !(c === 'manba_id' && kind !== 'STATS'))];
      out.push({ row: row.row, key: row.key, status: all.length ? 'update' : 'same', ...(all.length ? { changes: all } : {}), values: row.values });
    };
    if (kind === 'STATS') {
      const ex = await this.prisma.hpStat.findMany({ where: { period: { in: periods } } });
      const m = new Map(ex.map((e) => [`${e.period}|${e.regionCode}|${e.serviceCode}`, e as unknown as Record<string, unknown>]));
      for (const r of rows) cmp(r, m.get(r.key), [['xizmat_soni', 'quantity'], ['tarif', 'tariffTiyin'], ['daromad_sum', 'revenueTiyin'], ['reja_sum', 'planTiyin']]);
    } else if (kind === 'EMP_MONTHS') {
      const ex = await this.prisma.hpEmpMonth.findMany({ where: { period: { in: periods } } });
      const m = new Map(ex.map((e) => [`${e.period}|${e.employeePinfl}`, e as unknown as Record<string, unknown>]));
      for (const r of rows)
        cmp(r, m.get(r.key), [['hudud_id', 'regionCode'], ['ishlangan_kun', 'workedDays'], ['ish_soati', 'workHours'], ['ta_til_kun', 'vacationDays'], ['jami_xizmat_soni', 'totalQuantity'], ['jami_daromad_sum', 'totalRevenueTiyin'], ['reja_sum', 'planTiyin']]);
    } else if (kind === 'EMP_SERVICES') {
      const ex = await this.prisma.hpEmpService.findMany({ where: { period: { in: periods } } });
      const m = new Map(ex.map((e) => [`${e.period}|${e.regionCode}|${e.employeePinfl}|${e.serviceCode}`, e as unknown as Record<string, unknown>]));
      for (const r of rows) cmp(r, m.get(r.key), [['xizmat_soni', 'quantity'], ['tarif', 'tariffTiyin'], ['daromad_sum', 'revenueTiyin']]);
    } else if (kind === 'FACTORS') {
      const ex = await this.prisma.hpRegionFactor.findMany({ where: { period: { in: periods } } });
      const m = new Map(ex.map((e) => [`${e.period}|${e.regionCode}`, e as unknown as Record<string, unknown>]));
      for (const r of rows) cmp(r, m.get(r.key), [['faol_tadbirkorlar_soni', 'activeEntrepreneurs'], ['xodimlar_soni', 'employees'], ['ish_kunlari', 'workDays'], ['faol_xodimlar_soni', 'activeEmployees']]);
    } else {
      // Xizmatlar: yangi xizmat, yangi tarif yoki o'zgarmagan
      const [cats, tariffs] = await Promise.all([
        this.prisma.incomeCategory.findMany({ where: { code: { startsWith: 'SRV_' } }, select: { code: true, isActive: true } }),
        this.prisma.serviceTariff.findMany({ where: { status: 'APPROVED', regionCode: null }, orderBy: { validFrom: 'asc' } }),
      ]);
      const cat = new Map(cats.map((c) => [c.code, c]));
      const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
      for (const r of rows) {
        const code = String(r.values.xizmat_id);
        const from = (r.values.amal_boshlanish_sanasi as string | null) ?? today;
        const price = BigInt(r.values.amaldagi_tarif as number);
        const current = [...tariffs].reverse().find((t) => t.categoryCode === code && t.validFrom.toISOString().slice(0, 10) <= from);
        const changes: string[] = [];
        if (!cat.has(code)) changes.push('yangi xizmat');
        if (!current || current.priceTiyin !== price) changes.push('tarif');
        const active = r.values.faol_holat === false ? false : r.values.amal_tugash_sanasi && (r.values.amal_tugash_sanasi as string) < today ? false : true;
        if (cat.has(code) && cat.get(code)!.isActive !== active) changes.push('faol_holat');
        out.push({ row: r.row, key: r.key, status: !cat.has(code) ? 'new' : changes.length ? 'update' : 'same', ...(changes.length ? { changes } : {}), values: { ...r.values, _from: from, _active: active } });
      }
    }
    return out;
  }

  /** Xodimlar daromadi hudud daromadidan oshmasin (oy × hudud × xizmat) */
  private async crossCheckEmployees(payload: PayloadRow[]): Promise<Issue[]> {
    const sums = new Map<string, number>();
    for (const p of payload) {
      const k = `${p.values.oy}|${p.values.hudud_id}|${p.values.xizmat_id}`;
      sums.set(k, (sums.get(k) ?? 0) + Number(p.values.daromad_sum) / 100);
    }
    if (!sums.size) return [];
    const periods = [...new Set(payload.map((p) => String(p.values.oy)))];
    const ds = await this.data.dataset('merged', periods.sort()[0]!, periods.sort()[periods.length - 1]!, null);
    const out: Issue[] = [];
    for (const [k, v] of sums) {
      const c = ds.cells.get(k);
      if (c && v > c.rev * 1.01 + 1000) {
        const [p, r, s] = k.split('|');
        out.push({ row: null, level: 'warning', message: `${p} · hudud ${r} · ${s}: xodimlar daromadi ${Math.round(v).toLocaleString('ru-RU')} so'm — hudud daromadidan (${Math.round(c.rev).toLocaleString('ru-RU')}) ko'p` });
      }
    }
    return out.slice(0, 300);
  }

  /** Yuklangan oylik jami — dasturdagi Hududlar tushumi bilan mos kelmasa ogohlantirish */
  private async crossCheckStats(payload: PayloadRow[]): Promise<Issue[]> {
    if (!payload.length) return [];
    const periods = [...new Set(payload.map((p) => String(p.values.oy)))].sort();
    const ds = await this.data.dataset('system', periods[0]!, periods[periods.length - 1]!, null);
    const fileSum = new Map<string, number>();
    for (const p of payload) {
      const k = `${p.values.oy}|${p.values.hudud_id}`;
      fileSum.set(k, (fileSum.get(k) ?? 0) + Number(p.values.daromad_sum) / 100);
    }
    const sysSum = new Map<string, number>();
    for (const [k, c] of ds.cells) {
      const [p, r] = k.split('|');
      sysSum.set(`${p}|${r}`, (sysSum.get(`${p}|${r}`) ?? 0) + c.rev);
    }
    const out: Issue[] = [];
    for (const [k, v] of fileSum) {
      const s = sysSum.get(k);
      if (s === undefined) continue;
      if (Math.abs(v - s) > Math.max(1000, s * 0.01)) {
        const [p, r] = k.split('|');
        out.push({ row: null, level: 'warning', message: `${p} · hudud ${r}: fayldagi jami ${Math.round(v).toLocaleString('ru-RU')} so'm, dasturdagi Hududlar tushumi ${Math.round(s).toLocaleString('ru-RU')} so'm — farq bor (tasdiqlansa, prognozda yuklangan qiymat ishlatiladi)` });
      }
    }
    return out.slice(0, 300);
  }

  // ───────────────────────── Tasdiqlash ─────────────────────────

  async confirm(id: string, body: { policy?: unknown; excludeRows?: unknown }, userId: string) {
    const session = await this.prisma.hpImport.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Import sessiyasi topilmadi');
    if (session.status !== 'CHECKED') throw new BadRequestException(session.status === 'IMPORTED' ? 'Bu sessiya allaqachon import qilingan' : 'Sessiya bekor qilingan');
    const policy = body?.policy === 'insert' ? 'insert' : 'upsert';
    const exclude = new Set(Array.isArray(body?.excludeRows) ? (body!.excludeRows as unknown[]).map(Number).filter(Number.isInteger) : []);
    const kind = session.kind as ImportKind;
    // Tekshiruvdan keyin bazada o'zgarish bo'lgan bo'lishi mumkin — holat qayta hisoblanadi
    const rows = ((session.payload as unknown as PayloadRow[]) ?? []).filter((p) => !exclude.has(p.row));
    const fresh = await this.diff(kind, rows.map((p) => ({ row: p.row, key: p.key, values: p.values })));
    const todo = fresh.filter((p) => p.status === 'new' || (p.status === 'update' && policy === 'upsert'));
    const counts = { created: 0, updated: 0, skipped: fresh.length - todo.length, excluded: exclude.size };

    await this.prisma.$transaction(async (tx) => {
      for (const p of todo) {
        const v = p.values;
        if (kind === 'STATS') {
          const data = { quantity: Number(v.xizmat_soni), tariffTiyin: big(v.tarif), revenueTiyin: BigInt(v.daromad_sum as number), planTiyin: big(v.reja_sum), sourceRef: (v.manba_id as string) || null, note: (v.izoh as string) || null, importId: id };
          await tx.hpStat.upsert({ where: { period_regionCode_serviceCode: { period: v.oy as string, regionCode: v.hudud_id as number, serviceCode: v.xizmat_id as string } }, create: { period: v.oy as string, regionCode: v.hudud_id as number, serviceCode: v.xizmat_id as string, ...data }, update: data });
        } else if (kind === 'EMP_MONTHS') {
          const data = {
            regionCode: v.hudud_id as number,
            workedDays: v.ishlangan_kun as number,
            workHours: (v.ish_soati as number | null) ?? null,
            vacationDays: (v.ta_til_kun as number | null) ?? null,
            totalQuantity: (v.jami_xizmat_soni as number | null) ?? null,
            totalRevenueTiyin: big(v.jami_daromad_sum),
            planTiyin: big(v.reja_sum),
            active: v.faol_holat === false ? false : true,
            note: (v.izoh as string) || null,
            importId: id,
          };
          await tx.hpEmpMonth.upsert({ where: { period_employeePinfl: { period: v.oy as string, employeePinfl: v.xodim_id as string } }, create: { period: v.oy as string, employeePinfl: v.xodim_id as string, ...data }, update: data });
        } else if (kind === 'EMP_SERVICES') {
          const data = { quantity: Number(v.xizmat_soni), tariffTiyin: big(v.tarif), revenueTiyin: BigInt(v.daromad_sum as number), importId: id };
          await tx.hpEmpService.upsert({
            where: { period_regionCode_employeePinfl_serviceCode: { period: v.oy as string, regionCode: v.hudud_id as number, employeePinfl: v.xodim_id as string, serviceCode: v.xizmat_id as string } },
            create: { period: v.oy as string, regionCode: v.hudud_id as number, employeePinfl: v.xodim_id as string, serviceCode: v.xizmat_id as string, ...data },
            update: data,
          });
        } else if (kind === 'FACTORS') {
          const data = { activeEntrepreneurs: (v.faol_tadbirkorlar_soni as number | null) ?? null, employees: (v.xodimlar_soni as number | null) ?? null, workDays: (v.ish_kunlari as number | null) ?? null, activeEmployees: (v.faol_xodimlar_soni as number | null) ?? null, note: (v.izoh as string) || null, importId: id };
          await tx.hpRegionFactor.upsert({ where: { period_regionCode: { period: v.oy as string, regionCode: v.hudud_id as number } }, create: { period: v.oy as string, regionCode: v.hudud_id as number, ...data }, update: data });
        } else {
          const code = String(v.xizmat_id);
          const exists = await tx.incomeCategory.findUnique({ where: { code } });
          if (!exists) {
            const last = await tx.incomeCategory.findFirst({ where: { code: { startsWith: 'SRV_' } }, orderBy: { order: 'desc' } });
            await tx.incomeCategory.create({ data: { code, label: String(v.xizmat_nomi), isActive: Boolean(v._active), order: (last?.order ?? 0) + 1 } });
          } else if (exists.isActive !== Boolean(v._active)) {
            await tx.incomeCategory.update({ where: { code }, data: { isActive: Boolean(v._active) } });
          }
          if (p.changes?.includes('tarif') || !exists) {
            await tx.serviceTariff.create({
              data: { categoryCode: code, regionCode: null, priceTiyin: BigInt(v.amaldagi_tarif as number), validFrom: new Date(`${v._from as string}T00:00:00Z`), status: 'APPROVED', note: `Hudud uchun reja importi${v.izoh ? `: ${String(v.izoh)}` : ''}`, createdById: userId, decidedById: userId, decidedAt: new Date() },
            });
          }
        }
        if (p.status === 'new') counts.created += 1;
        else counts.updated += 1;
      }
      await tx.hpImport.update({ where: { id }, data: { status: 'IMPORTED', importedAt: new Date(), importedById: userId, policy, summary: { ...(session.summary as object), result: counts } } });
    });

    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'hudud_reja_import',
      entityId: id,
      summary: `Hudud uchun reja › ${KINDS[kind].title}: «${session.fileName}» — yangi ${counts.created}, yangilangan ${counts.updated}, o'tkazib yuborilgan ${counts.skipped}${counts.excluded ? `, chiqarilgan ${counts.excluded}` : ''}`,
    });
    return { ...this.view(await this.prisma.hpImport.findUnique({ where: { id } }), false), result: counts };
  }

  async cancel(id: string, userId: string) {
    const s = await this.prisma.hpImport.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Import sessiyasi topilmadi');
    if (s.status !== 'CHECKED') throw new BadRequestException('Faqat tekshirilgan (tasdiqlanmagan) sessiyani bekor qilish mumkin');
    await this.prisma.hpImport.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), payload: [] } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'hudud_reja_import', entityId: id, summary: `Import bekor qilindi: «${s.fileName}»` });
    return { ok: true };
  }

  async list(kind?: string) {
    const rows = await this.prisma.hpImport.findMany({
      where: kind && KIND_SET.has(kind) ? { kind } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, kind: true, fileName: true, fileSize: true, status: true, summary: true, createdById: true, createdAt: true, importedAt: true, importedById: true, cancelledAt: true, policy: true },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.createdById, r.importedById].filter(Boolean) as string[]))] } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({ ...r, createdBy: name.get(r.createdById) ?? null, importedBy: r.importedById ? (name.get(r.importedById) ?? null) : null }));
  }

  async get(id: string) {
    const s = await this.prisma.hpImport.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Import sessiyasi topilmadi');
    return this.view(s, true);
  }

  /** Mavjud ma'lumotlar holati — yuklash sahifasidagi bloklar uchun */
  async status() {
    const [stats, emp, empSvc, factors, last] = await Promise.all([
      this.prisma.hpStat.aggregate({ _count: { _all: true }, _min: { period: true }, _max: { period: true } }),
      this.prisma.hpEmpMonth.aggregate({ _count: { _all: true }, _min: { period: true }, _max: { period: true } }),
      this.prisma.hpEmpService.aggregate({ _count: { _all: true }, _min: { period: true }, _max: { period: true } }),
      this.prisma.hpRegionFactor.aggregate({ _count: { _all: true }, _min: { period: true }, _max: { period: true } }),
      this.prisma.hpImport.findMany({ where: { status: 'IMPORTED' }, orderBy: { importedAt: 'desc' }, select: { kind: true, importedAt: true, fileName: true } }),
    ]);
    const system = await this.prisma.income.aggregate({ where: { deletedAt: null, categoryCode: { startsWith: 'SRV_' }, regionCode: { gt: 0 } }, _count: { _all: true }, _min: { period: true }, _max: { period: true } });
    const services = await this.prisma.incomeCategory.count({ where: { code: { startsWith: 'SRV_' }, isActive: true } });
    const tariffs = await this.prisma.serviceTariff.findMany({ where: { status: 'APPROVED' }, select: { categoryCode: true } });
    const lastOf = (k: string) => last.find((l) => l.kind === k) ?? null;
    const row = (a: { _count: { _all: number }; _min: { period: string | null }; _max: { period: string | null } }, k: string) => ({ rows: a._count._all, from: a._min.period, to: a._max.period, lastImport: lastOf(k) });
    return {
      STATS: { ...row(stats, 'STATS'), system: { rows: system._count._all, from: system._min.period, to: system._max.period } },
      EMP_MONTHS: row(emp, 'EMP_MONTHS'),
      EMP_SERVICES: row(empSvc, 'EMP_SERVICES'),
      FACTORS: row(factors, 'FACTORS'),
      SERVICES: { rows: services, withTariff: new Set(tariffs.map((t) => t.categoryCode)).size, lastImport: lastOf('SERVICES') },
    };
  }

  private view(s: { id: string; kind: string; fileName: string; fileSize: number; status: string; summary: unknown; issues?: unknown; payload?: unknown; createdAt: Date; importedAt: Date | null } | null, withPreview: boolean) {
    if (!s) throw new NotFoundException('Import sessiyasi topilmadi');
    const payload = (s.payload as PayloadRow[] | undefined) ?? [];
    return {
      id: s.id,
      kind: s.kind,
      fileName: s.fileName,
      fileSize: s.fileSize,
      status: s.status,
      summary: s.summary,
      createdAt: s.createdAt,
      importedAt: s.importedAt,
      issues: withPreview ? ((s.issues as Issue[]) ?? []) : undefined,
      // Ko'rib chiqish: o'zgaradiganlar avval, keyin qolganlari (ko'pi bilan 300 qator)
      preview: withPreview
        ? [...payload]
            .sort((a, b) => (a.status === 'same' ? 1 : 0) - (b.status === 'same' ? 1 : 0) || a.row - b.row)
            .slice(0, 300)
            .map((p) => ({ row: p.row, status: p.status, changes: p.changes ?? [], values: p.values }))
        : undefined,
    };
  }
}