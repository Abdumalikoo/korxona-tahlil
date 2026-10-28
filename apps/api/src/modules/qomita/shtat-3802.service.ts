import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { runExclusive } from '../../common/locks';
import { toLatin } from '../acc-23106/acc23106.purpose';
import { AuditService } from '../audit/audit.service';
import { hrPeople } from '../hr-sheets/hr-sheets.store';
import { PrismaService } from '../prisma/prisma.service';
import { parseShtatWorkbook, pickShtatSheet, type ShtatSheet } from './shtat-3802.parse';

// ═══════════════════════════════════════════════════════════
// 3802 › Shtatlar — ikki toifa, har biri alohida yuklanadi:
//  • OLADI — Qo'mita hisobidan oladigan shtatlar («3802» varag'i);
//  • OLMAYDI — olmaydigan shtatlar («3802 олмайдиганлар» varag'i).
// Fayl — shtat jadvali (to'liq fayl yoki shablon bo'yicha alohida fayl): toifa varag'i, bo'lmasa — yagona shtat varag'i.
// Har fayl bo'limi: ilovadagi Markaz bo'limiga bog'lanadi (taklif — nomi bo'yicha, tasdiq — foydalanuvchi) va
// qoplash qoidasi (faqat OLADI): OKLAD_40 — Oklad va 40% ustama, FULL — hamma summa, NONE — qoplanmaydi.
// «Kimlar kiradi»: tanlangan oy ish haqi tarkibidagi xodimlar — bo'limi (xodimlar ro'yxati) va lavozimi
// (Kadrlar ma'lumotnomalari) bo'yicha shtatdagi lavozimga bog'lanadi.
// Saqlash: settings «3802.shtat.OLADI», «3802.shtat.OLMAYDI» (jadval) va «3802.shtat.map» (sozlama) — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export type ShtatKind = 'OLADI' | 'OLMAYDI';
export const SHTAT_KINDS: ShtatKind[] = ['OLADI', 'OLMAYDI'];
export const shtatKey = (kind: ShtatKind) => `3802.shtat.${kind}`;
export const SHTAT_MAP_KEY = '3802.shtat.map';
export const KIND_TITLE: Record<ShtatKind, string> = { OLADI: '3802 оладиганлар', OLMAYDI: '3802 олмайдиганлар' };

export type Coverage = 'OKLAD_40' | 'FULL' | 'NONE';
export const COVERAGES: Coverage[] = ['OKLAD_40', 'FULL', 'NONE'];

export interface SectionSetting {
  departmentId: string | null;
  coverage: Coverage;
  at: string;
  by: string;
}

interface ShtatStore {
  fileName: string;
  savedAt: string;
  savedBy: string;
  sheet: ShtatSheet;
}

const norm = (s: string) =>
  toLatin(
    String(s ?? '')
      // Aralash yozuv: lotin so'z ichidagi kirill «С» («Сall-markazi») — lotin «c»
      .replace(/[сС](?=[A-Za-z])/g, 'c'),
  )
    .replace(/[ʻʼ‘’`'"«»]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Bo'lim sozlamasi kaliti: toifa va bo'lim nomi (tartib raqamisiz) — qayta yuklansa ham o'zgarmaydi */
export const sectionKey = (kind: ShtatKind, section: string) => `${kind}|${norm(section)}`;

const STOP = new Set(['bolim', 'bolimi', 'boyicha', 'bilan', 'va', 'xizmati', 'xizmat', 'xizmatlari', 'korsatish', 'buyicha', 'ishlash', 'ishlari', 'sho', 'shuba', 'shobasi', 'bosh', 'mutaxassis']);
/** Ilovadagi qisqa nomlar: «Раҳбарият» — AUP, «Юридик бюро» — Yurist */
const SYNONYM: Record<string, string> = { rahba: 'aup', yurid: 'yuris' };
const stems = (s: string) =>
  norm(s)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .flatMap((w) => [w.slice(0, 5), ...(SYNONYM[w.slice(0, 5)] ? [SYNONYM[w.slice(0, 5)]!] : [])]);

/** Fayl bo'limi → ilovadagi bo'lim (taklif): bo'lim nomidagi so'z o'zaklarining ko'pi fayl nomida bo'lsa */
export function suggestDepartment(section: string, deps: { id: string; name: string }[]): string | null {
  const have = new Set(stems(section));
  let best: { id: string; score: number; size: number } | null = null;
  for (const d of deps) {
    const want = [...new Set(stems(d.name))];
    if (!want.length) continue;
    const hit = want.filter((w) => have.has(w)).length;
    const score = hit / want.length;
    if (score >= 0.5 && (!best || score > best.score || (score === best.score && want.length > best.size))) best = { id: d.id, score, size: want.length };
  }
  return best?.id ?? null;
}

/** Lavozim o'zaklari («Bosh mutaxassisi (0,5 stavka)» ≈ «Бош мутахассис»): stavka va raqamlarsiz */
const POS_STOP = new Set(['stavka', 'stavkasi', 'boyicha', 'buyicha', 'bilan', 'va']);
const posStems = (s: string) => [
  ...new Set(
    norm(s)
      .split(' ')
      .filter((w) => w.length >= 3 && !/^\d/.test(w) && !POS_STOP.has(w))
      .map((w) => w.slice(0, 5)),
  ),
];

/** Ko'p lavozimda uchraydigan so'zlar — yolg'iz o'zi moslik bermaydi */
const GENERIC = new Set(['bosh', 'bolim', 'boshl', 'mutax', 'shuba', 'shoba']);

/**
 * Xodim lavozimi → shtat lavozimi (eng o'xshashi; topilmasa — null):
 *  • mos so'zlar orasida umumiy bo'lmagani bor: umumiy o'zaklar / ko'prog'i ≥ 0,5 yoki qisqa shakl
 *    («Haydovchisi» ≈ «Енгил автомобиль ҳайдовчиси»): umumiy / kamrog'i ≥ 0,5;
 *  • faqat umumiy so'zlar («bosh», «bo'lim», «boshlig'i», «mutaxassis») mos: kamida ikkitasi va umumiy / ko'prog'i ≥ 0,5
 *    («Bosh hisobchi» ≠ «Бош мутахассис»).
 * Tanlov: avval to'liqroq moslik (umumiy / ko'prog'i), keyin qisqa shakl bo'yicha.
 */
export function matchPosition(position: string, candidates: string[]): number | null {
  const a = posStems(position);
  if (!a.length) return null;
  let best: { i: number; full: number; part: number } | null = null;
  candidates.forEach((c, i) => {
    const b = posStems(c);
    if (!b.length) return;
    const common = a.filter((x) => b.includes(x));
    const full = common.length / Math.max(a.length, b.length);
    const part = common.length / Math.min(a.length, b.length);
    const specific = common.some((x) => !GENERIC.has(x));
    // Faqat umumiy so'zlar: kamida ikkitasi — yoki xodim lavozimi bitta so'z va u shtat lavozimida bor («Boshlig'i»)
    const ok = specific ? full >= 0.5 || part >= 0.5 : (common.length >= 2 && full >= 0.5) || (a.length === 1 && common.length === 1);
    if (!ok) return;
    if (!best || full > best.full || (full === best.full && part > best.part)) best = { i, full, part };
  });
  return (best as { i: number } | null)?.i ?? null;
}

export const defaultCoverage = (kind: ShtatKind): Coverage => (kind === 'OLADI' ? 'OKLAD_40' : 'NONE');
const kindOf = (raw: unknown): ShtatKind => {
  if (raw === 'OLADI' || raw === 'OLMAYDI') return raw;
  throw new BadRequestException("Toifa noto'g'ri — OLADI yoki OLMAYDI");
};

@Injectable()
export class Shtat3802Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async read(): Promise<{ stores: Partial<Record<ShtatKind, ShtatStore>>; map: Record<string, SectionSetting> }> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: [...SHTAT_KINDS.map(shtatKey), SHTAT_MAP_KEY] } }, select: { key: true, value: true } });
    const stores: Partial<Record<ShtatKind, ShtatStore>> = {};
    for (const k of SHTAT_KINDS) {
      const v = rows.find((r) => r.key === shtatKey(k))?.value as ShtatStore | undefined;
      if (v?.sheet && Array.isArray(v.sheet.sections)) stores[k] = v;
    }
    const m = rows.find((r) => r.key === SHTAT_MAP_KEY)?.value as Record<string, SectionSetting> | undefined;
    return { stores, map: m && typeof m === 'object' && !Array.isArray(m) ? m : {} };
  }

  private async departments() {
    return this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  }

  private async userName(userId: string) {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
  }

  private async parse(kind: ShtatKind, file: Express.Multer.File | undefined): Promise<ShtatSheet> {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    await assertSafeXlsx(file.buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang");
    }
    return pickShtatSheet(parseShtatWorkbook(wb), kind);
  }

  /** Varaq + har bo'lim sozlamasi (saqlangani, bo'lmasa — taklif va sukut qoida) + Qo'mita qoplashi (oylik, shtat bo'yicha) */
  private present(kind: ShtatKind, sheet: ShtatSheet, map: Record<string, SectionSetting>, deps: { id: string; name: string }[]) {
    const depName = new Map(deps.map((d) => [d.id, d.name]));
    let covered = 0n;
    const sections = sheet.sections.map((sec) => {
      const key = sectionKey(kind, sec.name);
      const saved = map[key];
      const departmentId = saved ? saved.departmentId : suggestDepartment(sec.name, deps);
      // Olmaydiganlar — Qo'mita qoplamaydi (qoida o'zgarmaydi)
      const coverage = kind === 'OLMAYDI' ? 'NONE' : (saved?.coverage ?? defaultCoverage(kind));
      const coveredTiyin = coverage !== 'NONE' ? sec.totalTiyin : '0';
      covered += BigInt(coveredTiyin);
      return {
        ...sec,
        settingKey: key,
        departmentId,
        departmentName: departmentId ? (depName.get(departmentId) ?? "Bo'lim (o'chirilgan)") : null,
        /** Bog'lash — siz tasdiqlagan (SAVED) yoki nomi bo'yicha taklif (SUGGESTED) */
        mapping: saved ? ('SAVED' as const) : departmentId ? ('SUGGESTED' as const) : ('NONE' as const),
        coverage,
        coveredTiyin,
      };
    });
    return {
      sheet: { ...sheet, kind, sections },
      summary: {
        units: sheet.units,
        totalTiyin: sheet.totalTiyin,
        /** Shtat bo'yicha Qo'mita qoplashi (oylik) — faqat OLADI */
        coveredMonthlyTiyin: covered.toString(),
        fullSections: sections.filter((s) => s.coverage === 'FULL').length,
        unmapped: sections.filter((s) => !s.departmentId).length,
        suggested: sections.filter((s) => s.mapping === 'SUGGESTED').length,
        mismatched: sections.filter((s) => !s.ok).length,
      },
    };
  }

  /** Faylni o'qish — hech narsa saqlanmaydi */
  async analyze(kindRaw: unknown, file: Express.Multer.File | undefined) {
    const kind = kindOf(kindRaw);
    const sheet = await this.parse(kind, file);
    const [{ map }, deps] = await Promise.all([this.read(), this.departments()]);
    return { kind, fileName: String(file?.originalname ?? 'shtat.xlsx').slice(0, 200), ...this.present(kind, sheet, map, deps) };
  }

  /** Saqlash: fayl qayta o'qiladi (mijozdan kelgan ma'lumotga tayanilmaydi); shu toifaning avvalgi jadvali almashtiriladi */
  async commit(kindRaw: unknown, file: Express.Multer.File | undefined, userId: string) {
    const kind = kindOf(kindRaw);
    const sheet = await this.parse(kind, file);
    const fileName = String(file?.originalname ?? 'shtat.xlsx').slice(0, 200);
    const store: ShtatStore = { fileName, savedAt: new Date().toISOString(), savedBy: await this.userName(userId), sheet: { ...sheet, kind } };
    const value = store as unknown as object;
    await this.prisma.setting.upsert({ where: { key: shtatKey(kind) }, create: { key: shtatKey(kind), value }, update: { value } });
    await this.audit.log({ userId, action: 'IMPORT', entity: 'shtat_3802', entityId: shtatKey(kind), summary: `3802 shtat (${KIND_TITLE[kind]}) yuklandi: ${fileName} — «${sheet.sheet}» varag'i, ${sheet.sections.length} bo'lim, ${sheet.units} birlik` });
    return { success: true as const, kind, sections: sheet.sections.length, units: sheet.units };
  }

  /** Yuklangan shtat jadvalini o'chirish (shu toifa); bo'lim bog'lashlari qoladi — qayta yuklanganda ishlatiladi */
  async remove(kindRaw: unknown, userId: string) {
    const kind = kindOf(kindRaw);
    const had = await this.prisma.setting.findUnique({ where: { key: shtatKey(kind) }, select: { key: true, value: true } });
    if (!had) throw new NotFoundException(`${KIND_TITLE[kind]} shtati yuklanmagan`);
    await this.prisma.setting.delete({ where: { key: shtatKey(kind) } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'shtat_3802', entityId: shtatKey(kind), summary: `3802 shtat (${KIND_TITLE[kind]}) o'chirildi: ${String((had.value as { fileName?: string } | null)?.fileName ?? '').slice(0, 200)}` });
    return { removed: true as const, kind };
  }

  /** Ikkala toifa: saqlangan jadval (yo'q bo'lsa — null) va bo'limlar ro'yxati (bog'lash uchun) */
  async view() {
    const [{ stores, map }, deps] = await Promise.all([this.read(), this.departments()]);
    const one = (k: ShtatKind) => {
      const s = stores[k];
      return s ? { fileName: s.fileName, savedAt: s.savedAt, savedBy: s.savedBy, ...this.present(k, s.sheet, map, deps) } : null;
    };
    return { OLADI: one('OLADI'), OLMAYDI: one('OLMAYDI'), departments: deps, coverages: COVERAGES };
  }

  /** Bo'lim sozlamasi: { kind, section, departmentId (null — bog'lanmagan), coverage } */
  async setSection(body: { kind?: unknown; section?: unknown; departmentId?: unknown; coverage?: unknown }, userId: string) {
    const kind = kindOf(body?.kind);
    const section = typeof body?.section === 'string' ? body.section : '';
    if (!section) throw new BadRequestException("Bo'lim kerak");
    const coverage = kind === 'OLMAYDI' ? 'NONE' : COVERAGES.includes(body?.coverage as Coverage) ? (body.coverage as Coverage) : null;
    if (!coverage) throw new BadRequestException("Qoplash qoidasi noto'g'ri");
    const departmentId = typeof body?.departmentId === 'string' && body.departmentId ? body.departmentId : null;
    if (departmentId) {
      const d = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { isActive: true } });
      if (!d?.isActive) throw new BadRequestException("Bo'lim topilmadi");
    }
    const { stores } = await this.read();
    const sec = stores[kind]?.sheet.sections.find((s) => s.name === section);
    if (!sec) throw new NotFoundException("Bo'lim saqlangan shtat jadvalida yo'q — avval jadvalni yuklang");
    const by = await this.userName(userId);
    const key = sectionKey(kind, section);
    await runExclusive(`setting:${SHTAT_MAP_KEY}`, async () => {
      const { map } = await this.read();
      map[key] = { departmentId, coverage, at: new Date().toISOString(), by };
      const value = map as unknown as object;
      await this.prisma.setting.upsert({ where: { key: SHTAT_MAP_KEY }, create: { key: SHTAT_MAP_KEY, value }, update: { value } });
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'shtat_3802', entityId: key.slice(0, 190), summary: `3802 shtat (${KIND_TITLE[kind]}) — «${sec.name.slice(0, 80)}»: qoplash ${coverage}${departmentId ? '' : ", bo'limga bog'lanmagan"}` });
    return { success: true as const, key, departmentId, coverage };
  }

  /**
   * Shu toifaga kimlar kiradi (period — ish haqi tarkibi oyi, bo'lmasa — oxirgisi):
   * har bo'lim (ilovadagi bo'limga bog'langan) → shtat lavozimlari → xodimlar (lavozimi shtatdagiga mos);
   * bo'limda bo'lib, lavozimi shtatda topilmaganlar — «others».
   */
  async members(kindRaw: unknown, periodRaw?: unknown) {
    const kind = kindOf(kindRaw);
    const [{ stores, map }, deps] = await Promise.all([this.read(), this.departments()]);
    const store = stores[kind];
    const batches = await this.prisma.salaryCompositionBatch.findMany({ where: { cancelledAt: null }, select: { id: true, period: true, createdAt: true }, orderBy: [{ period: 'desc' }, { createdAt: 'desc' }] });
    const periods = [...new Set(batches.map((b) => b.period))];
    const period = typeof periodRaw === 'string' && periods.includes(periodRaw) ? periodRaw : (periods[0] ?? null);
    if (!store) return { kind, period, periods, sections: [], totals: { units: 0, members: 0, others: 0 }, unmappedSections: 0, noPosition: 0 };
    const sheet = this.present(kind, store.sheet, map, deps).sheet;
    const batch = period ? batches.find((b) => b.period === period) : null;
    const rows = batch ? await this.prisma.salaryCompositionRow.findMany({ where: { batchId: batch.id }, select: { id: true, employeePinfl: true, fullName: true, totalTiyin: true } }) : [];
    const items = rows.length ? await this.prisma.salaryCompositionItem.findMany({ where: { batchId: batch!.id, componentCode: { in: ['OKLAD', 'OKLAD_40'] } }, select: { rowId: true, componentCode: true, amountTiyin: true } }) : [];
    const emps = rows.length ? await this.prisma.employee.findMany({ where: { pinfl: { in: rows.map((r) => r.employeePinfl) } }, select: { pinfl: true, fullName: true, departmentId: true } }) : [];
    const people = rows.length ? await hrPeople(this.prisma) : new Map();
    const empBy = new Map(emps.map((e) => [e.pinfl, e]));
    const amount = new Map<string, { oklad: bigint; ustama: bigint }>();
    for (const it of items) {
      const x = amount.get(it.rowId) ?? { oklad: 0n, ustama: 0n };
      if (it.componentCode === 'OKLAD') x.oklad += it.amountTiyin;
      else x.ustama += it.amountTiyin;
      amount.set(it.rowId, x);
    }
    // Bo'lim → shu bo'limdagi tarkib xodimlari
    const byDep = new Map<string, { pinfl: string; fullName: string; position: string; okladTiyin: string; ustamaTiyin: string; totalTiyin: string }[]>();
    let noPosition = 0;
    for (const r of rows) {
      const e = empBy.get(r.employeePinfl);
      if (!e?.departmentId) continue;
      const position = people.get(r.employeePinfl)?.position?.replace(/\s+/g, ' ').trim() ?? '';
      if (!position) noPosition += 1;
      const a = amount.get(r.id) ?? { oklad: 0n, ustama: 0n };
      const list = byDep.get(e.departmentId) ?? [];
      list.push({ pinfl: r.employeePinfl, fullName: r.fullName ?? e.fullName, position, okladTiyin: a.oklad.toString(), ustamaTiyin: a.ustama.toString(), totalTiyin: r.totalTiyin.toString() });
      byDep.set(e.departmentId, list);
    }
    // Bir bo'limga bir nechta fayl bo'limi bog'langan bo'lishi mumkin — lavozimlar birga solishtiriladi
    const secsOf = new Map<string, typeof sheet.sections>();
    for (const s of sheet.sections) if (s.departmentId) secsOf.set(s.departmentId, [...(secsOf.get(s.departmentId) ?? []), s]);
    type Member = NonNullable<ReturnType<typeof byDep.get>>[number];
    const assigned = new Map<string, Member[]>();
    const others = new Map<string, Member[]>();
    for (const [dep, secs] of secsOf) {
      const cands = secs.flatMap((s) => s.positions.map((p) => ({ sec: s.key, row: p.row, name: p.name })));
      for (const m of byDep.get(dep) ?? []) {
        const i = m.position ? matchPosition(m.position, cands.map((c) => c.name)) : null;
        if (i === null) {
          // Lavozimi shtatda yo'q — birinchi bog'langan bo'limga «boshqalar» sifatida
          others.set(secs[0]!.key, [...(others.get(secs[0]!.key) ?? []), m]);
          continue;
        }
        const k = `${cands[i]!.sec}:${cands[i]!.row}`;
        assigned.set(k, [...(assigned.get(k) ?? []), m]);
      }
    }
    const sortM = (l: Member[]) => [...l].sort((a, b) => a.fullName.localeCompare(b.fullName));
    const sections = sheet.sections.map((s) => {
      const positions = s.positions.map((p) => {
        const members = sortM(assigned.get(`${s.key}:${p.row}`) ?? []);
        return { name: p.name, units: p.units, members, filled: members.length };
      });
      const extra = sortM(others.get(s.key) ?? []);
      return { key: s.key, name: s.name, departmentId: s.departmentId, departmentName: s.departmentName, mapping: s.mapping, units: s.units, positions, others: extra, members: positions.reduce((t, p) => t + p.filled, 0) };
    });
    return {
      kind,
      period,
      periods,
      sections,
      totals: { units: sheet.units, members: sections.reduce((t, s) => t + s.members, 0), others: sections.reduce((t, s) => t + s.others.length, 0) },
      unmappedSections: sheet.sections.filter((s) => !s.departmentId).length,
      /** Tarkibda bo'lib, ma'lumotnomalarda lavozimi topilmagan xodimlar (bog'lab bo'lmaydi) */
      noPosition,
    };
  }

  /** Shablon: fayldagi shakl (sarlavha, ustunlar), bo'sh — bo'lim va lavozimlar qo'shiladi; «Yo'riqnoma» varag'i bilan */
  async template(kindRaw: unknown): Promise<{ buffer: Buffer; filename: string }> {
    const kind = kindOf(kindRaw);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet(kind === 'OLADI' ? '3802' : '3802- olmaydigan');
    ws.getCell('A10').value = '"Солиқ сервис" Акциядорлик жамияти';
    ws.getCell('A11').value = 'ШТАТЛАР ЖАДВАЛИ';
    ws.getCell('A12').value = KIND_TITLE[kind];
    for (const r of [10, 11, 12]) {
      ws.mergeCells(r, 1, r, 10);
      ws.getCell(r, 1).alignment = { horizontal: 'center' };
      ws.getCell(r, 1).font = { bold: true, size: r === 11 ? 13 : 11 };
    }
    const head = ['№', 'Лавозимлар номи', 'Штат бирлиги', 'Тариф разряди', 'МҲТ тариф сеткаси', 'Рағбат. коефф.', 'Тариф коэфф.', 'Бир штат бирлиги лавозим маоши (сўм)', 'Рағбат-ш коэф. (сўм)', 'Жами штат бирлиги учун лавозим маоши (сўм)'];
    const widths = [6, 44, 10, 10, 10, 10, 10, 18, 16, 20];
    head.forEach((h, i) => {
      const c = ws.getCell(14, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      ws.getColumn(i + 1).width = widths[i]!;
    });
    ws.getRow(14).height = 48;
    for (const col of [8, 9, 10]) ws.getColumn(col).numFmt = '#,##0';
    ws.views = [{ state: 'frozen', ySplit: 14 }];
    const help = wb.addWorksheet("Yo'riqnoma");
    help.getColumn(1).width = 120;
    [
      `${KIND_TITLE[kind]} — shtat jadvali shabloni`,
      '',
      `• «${ws.name}» varag'iga 15-qatordan boshlab yozing (sarlavha — 14-qator, o'zgartirmang).`,
      "• Bo'lim: A ustuniga bo'lim nomi (masalan: «1. Раҳбарият», «2. Ички аудит хизмати») — shu qatorda boshqa ustun to'ldirilmaydi.",
      "• Lavozim: A — tartib raqami, B — lavozim nomi, C — shtat birligi (0,5 ham bo'ladi), D — tarif razryadi, H — bitta birlik lavozim maoshi (Oklad), I — rag'batlantirish ustamasi (40%), J — jami (C × (H + I)).",
      "• Bo'lim oxirida: B ustuniga «Жами:», C — birliklar soni, J — jami summa (tekshiruv uchun; bo'lmasa ham bo'ladi).",
      "• Varaq oxirida «Жами ходимлар бўйича» qatori bo'lishi mumkin — undan keyingi qatorlar o'qilmaydi.",
      "• Sarlavhaga imzo chekuvchilar yozilishi mumkin — ular saqlanmaydi.",
      "• Fayl tizimga yuklangach, bo'limlarni ilovadagi bo'limlarga bog'lang — pastda shu toifaga kimlar kirishi (ish haqi tarkibi va lavozimi bo'yicha) ko'rinadi.",
    ].forEach((t, i) => {
      help.getCell(i + 1, 1).value = t;
      if (i === 0) help.getCell(1, 1).font = { bold: true, size: 12 };
    });
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `3802-shtat-${kind === 'OLADI' ? 'oladiganlar' : 'olmaydiganlar'}-shablon.xlsx` };
  }
}
