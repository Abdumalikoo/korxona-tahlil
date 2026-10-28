import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runExclusive } from '../../common/locks';
import { monthsBetween } from '../../common/period';
import { assertAmount } from '../../common/validation/amount';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { renderExcel } from '../reports/render.excel';
import { FORMAT_INFO, type Cell, type ReportDoc } from '../reports/reports.types';
import { periodLabel, safeFile } from '../reports/reports.format';

// ═══════════════════════════════════════════════════════════
// Hisobga olinmaydigan tushumlar (Daromadlar › …): depozitga yo'naltirilgan mablag'lar, ustav fondini shakllantirish.
// Daromadlar bo'limida ko'rinadi, lekin daromad EMAS — jami daromad, natija, rentabellik, hisobotlar va prognozlarga
// qo'shilmaydi. Shuning uchun daromadlar jadvalida (incomes) emas, alohida saqlanadi — settings, migratsiyasiz:
//   «excluded_income.items» — yozuvlar ro'yxati (summa tiyinda, matn ko'rinishida — BigInt JSON'ga sig'maydi).
// ═══════════════════════════════════════════════════════════

const KEY = 'excluded_income.items';

export const EXCLUDED_KINDS = [
  { code: 'DEPOZIT', label: "Depozitga yo'naltirilgan mablag'lar" },
  { code: 'USTAV_FONDI', label: 'Ustav fondini shakllantirish' },
] as const;
export type ExcludedKind = (typeof EXCLUDED_KINDS)[number]['code'];

export interface ExcludedItem {
  id: string;
  kind: ExcludedKind;
  /** YYYY-MM-DD */
  date: string;
  amountTiyin: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ExcludedActor {
  id: string;
  fullName?: string;
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const labelOf = (k: ExcludedKind) => EXCLUDED_KINDS.find((x) => x.code === k)!.label;
const som = (t: bigint) => (Number(t) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/ /g, ' ');

@Injectable()
export class ExcludedIncomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async items(): Promise<ExcludedItem[]> {
    const v = (await this.prisma.setting.findUnique({ where: { key: KEY } }))?.value;
    return Array.isArray(v) ? (v as unknown as ExcludedItem[]) : [];
  }

  private async save(list: ExcludedItem[]) {
    const value = list as unknown as object;
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  }

  /** Kiritilgan qiymatlarni tekshirish: tur, sana, summa (tiyin, > 0), izoh */
  private clean(body: { kind?: unknown; date?: unknown; amountTiyin?: unknown; note?: unknown }) {
    const kind = EXCLUDED_KINDS.find((k) => k.code === body?.kind)?.code;
    if (!kind) throw new BadRequestException('Turini tanlang');
    const date = typeof body?.date === 'string' ? body.date.slice(0, 10) : '';
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) throw new BadRequestException("Sana noto'g'ri");
    const raw = typeof body?.amountTiyin === 'number' || typeof body?.amountTiyin === 'string' ? String(body.amountTiyin).trim() : '';
    if (!/^\d+$/.test(raw)) throw new BadRequestException('Summa butun son bo‘lishi kerak (tiyinda)');
    const amount = assertAmount(BigInt(raw));
    if (amount <= 0n) throw new BadRequestException('Summa noldan katta bo‘lishi kerak');
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    return { kind, date, amountTiyin: amount.toString(), note };
  }

  /** Davr (oylar) bo'yicha ro'yxat, oyma-oy va tur bo'yicha jami */
  async list(fromRaw: unknown, toRaw: unknown) {
    const from = String(fromRaw ?? '');
    const to = String(toRaw ?? '');
    if (!PERIOD_RE.test(from) || !PERIOD_RE.test(to) || from > to) throw new BadRequestException("Davr noto'g'ri (YYYY-MM)");
    const months = monthsBetween(from, to);
    const all = await this.items();
    const items = all.filter((i) => i.date.slice(0, 7) >= from && i.date.slice(0, 7) <= to).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const byKind = Object.fromEntries(EXCLUDED_KINDS.map((k) => [k.code, 0n])) as Record<ExcludedKind, bigint>;
    const byMonth = new Map(months.map((m) => [m, Object.fromEntries(EXCLUDED_KINDS.map((k) => [k.code, 0n])) as Record<ExcludedKind, bigint>]));
    for (const i of items) {
      const v = BigInt(i.amountTiyin);
      byKind[i.kind] += v;
      const row = byMonth.get(i.date.slice(0, 7));
      if (row) row[i.kind] += v;
    }
    const total = Object.values(byKind).reduce((a, b) => a + b, 0n);
    return {
      from,
      to,
      kinds: EXCLUDED_KINDS.map((k) => ({ ...k, totalTiyin: byKind[k.code].toString() })),
      totalTiyin: total.toString(),
      months: months.map((m) => {
        const r = byMonth.get(m)!;
        return { period: m, byKind: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.toString()])), totalTiyin: Object.values(r).reduce((a, b) => a + b, 0n).toString() };
      }),
      items,
    };
  }

  async create(actor: ExcludedActor, body: { kind?: unknown; date?: unknown; amountTiyin?: unknown; note?: unknown }) {
    const c = this.clean(body);
    const item: ExcludedItem = { id: randomUUID(), ...c, createdAt: new Date().toISOString(), createdBy: actor.fullName ?? '', updatedAt: null, updatedBy: null };
    await runExclusive(`setting:${KEY}`, async () => this.save([...(await this.items()), item]));
    await this.audit.log({ userId: actor.id, action: 'CREATE', entity: 'excluded_income', entityId: item.id, summary: `Hisobga olinmaydigan tushum: ${labelOf(c.kind)}, ${c.date}, ${som(BigInt(c.amountTiyin))} so'm` });
    return item;
  }

  async update(actor: ExcludedActor, id: string, body: { kind?: unknown; date?: unknown; amountTiyin?: unknown; note?: unknown }) {
    const c = this.clean(body);
    const { before, item } = await runExclusive(`setting:${KEY}`, async () => {
      const list = await this.items();
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) throw new NotFoundException('Yozuv topilmadi');
      const prev = list[i]!;
      const next: ExcludedItem = { ...prev, ...c, updatedAt: new Date().toISOString(), updatedBy: actor.fullName ?? '' };
      list[i] = next;
      await this.save(list);
      return { before: prev, item: next };
    });
    await this.audit.log({
      userId: actor.id,
      action: 'UPDATE',
      entity: 'excluded_income',
      entityId: id,
      summary: `Hisobga olinmaydigan tushum o'zgardi: ${labelOf(before.kind)}, ${before.date}, ${som(BigInt(before.amountTiyin))} → ${labelOf(item.kind)}, ${item.date}, ${som(BigInt(item.amountTiyin))} so'm`,
    });
    return item;
  }

  async remove(actor: ExcludedActor, id: string) {
    const removed = await runExclusive(`setting:${KEY}`, async () => {
      const list = await this.items();
      const item = list.find((x) => x.id === id);
      if (!item) throw new NotFoundException('Yozuv topilmadi');
      await this.save(list.filter((x) => x.id !== id));
      return item;
    });
    await this.audit.log({ userId: actor.id, action: 'DELETE', entity: 'excluded_income', entityId: id, summary: `Hisobga olinmaydigan tushum o'chirildi: ${labelOf(removed.kind)}, ${removed.date}, ${som(BigInt(removed.amountTiyin))} so'm` });
    return { deleted: true };
  }

  /** Excel: oyma-oy (tur bo'yicha) va yozuvlar ro'yxati */
  async export(fromRaw: unknown, toRaw: unknown): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const s = await this.list(fromRaw, toRaw);
    const m = (t: string) => Number(t) / 100;
    const doc: ReportDoc = {
      kind: 'Hisobga olinmaydigan tushumlar',
      title: 'Hisobga olinmaydigan tushumlar',
      subtitle: `${periodLabel(s.from)} — ${periodLabel(s.to)}`,
      meta: [`${s.items.length} ta yozuv`],
      highlights: [
        `Jami: ${som(BigInt(s.totalTiyin))} so'm — daromadga QO'SHILMAGAN (jami daromad, natija va hisobotlarda hisoblanmaydi).`,
        ...s.kinds.map((k) => `${k.label}: ${som(BigInt(k.totalTiyin))} so'm.`),
      ],
      sections: [
        {
          title: 'Oyma-oy',
          sheet: 'Oyma-oy',
          blocks: [
            {
              type: 'table',
              columns: [{ label: 'Oy', width: 1.4 }, ...EXCLUDED_KINDS.map((k) => ({ label: k.label, format: 'money' as const, width: 1.8 })), { label: 'Jami', format: 'money' }],
              rows: s.months.map((r) => [periodLabel(r.period), ...EXCLUDED_KINDS.map((k) => m(r.byKind[k.code] ?? '0')), m(r.totalTiyin)] as Cell[]),
            },
          ],
        },
        {
          title: 'Yozuvlar',
          sheet: 'Yozuvlar',
          blocks: s.items.length
            ? [
                {
                  type: 'table',
                  filter: true,
                  columns: [{ label: 'Sana', width: 1.1 }, { label: 'Turi', width: 2.2 }, { label: "Summa (so'm)", format: 'money' }, { label: 'Izoh', width: 2.6 }, { label: 'Kiritgan', width: 1.6 }],
                  rows: s.items.map((i) => [i.date, labelOf(i.kind), m(i.amountTiyin), i.note ?? '', i.createdBy] as Cell[]),
                },
              ]
            : [{ type: 'notes', items: ['Bu davrda yozuv yo‘q.'] }],
        },
      ],
      fileBase: safeFile(`Hisobga olinmaydigan tushumlar - ${s.from}_${s.to}`),
      generatedAt: new Date().toISOString(),
      coverSheet: 'Xulosa',
      ownMethodology: true,
    };
    return { buffer: await renderExcel(doc), filename: `${doc.fileBase}.${FORMAT_INFO.xlsx.ext}`, mime: FORMAT_INFO.xlsx.mime };
  }
}
