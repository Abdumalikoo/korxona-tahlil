import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { translit } from '../leases/leases.match';
import { PrismaService } from '../prisma/prisma.service';
import { FixedAssetsService } from './fixed-assets.service';

// ═══════════════════════════════════════════════════════════
// Excel'dan yuklangan asosiy vositalarni omborga ulash.
// Har bir vosita (dona) ombor ro'yxatiga kiradi: «Foydalanishda», joyi — hudud / Markaz bo'limi,
// kimda — qabul qiluvchi xodim (familiya + ism bosh harfi bo'yicha Xodimlar ro'yxatidan topiladi).
// Shundan keyin vosita xodim nomida ko'rinadi, qaytarish / boshqaga o'tkazish / hisobdan chiqarish
// oddiy ombor hujjatlari va dalolatnomalari bilan qilinadi. Balans (rejim) o'zgarmaydi — xarajatga yozilmaydi.
// Bir qatorda bir nechta dona bo'lsa — har donasi alohida vosita (qiymat teng bo'linadi).
// ═══════════════════════════════════════════════════════════

export interface AdoptPreview {
  total: number;
  pieces: number;
  matched: number;
  unmatched: { name: string; count: number; reason: string }[];
  holders: { name: string; employee: string | null; pinfl: string | null; count: number }[];
  renumbered: number;
  alreadyLinked: number;
}

export interface AdoptResult extends AdoptPreview {
  created: number;
  items: number;
}

interface EmpRow {
  pinfl: string;
  fullName: string;
  lastName: string;
  firstName: string;
  regionCode: number;
  departmentId: string | null;
}

/** Ism-familiyani solishtirish kaliti: lotin, kichik harf, belgisiz, «iyev/yev» → «ev», «kh» → «x» */
export function nameKey(value: string): string {
  return translit(value)
    .replace(/[ʻ‘’'`]/g, '')
    .replace(/kh/g, 'x')
    .replace(/iy/g, 'i')
    .replace(/yev\b/g, 'ev')
    .replace(/yeva\b/g, 'eva')
    .replace(/[^a-z]/g, '');
}

/**
 * «A.Shodmonov», «Rasulova.D», «Sh.Yuldashev topshirdi», «S.Aminboyev + F.Maxmudova»
 * → asosiy qabul qiluvchi: familiya va ism bosh harfi
 */
export function parseHolder(raw: string): { surname: string; initial: string; others: string[] } | null {
  const parts = raw.split(/\s*[+,;&]\s*|\s+va\s+/i).map((s) => s.trim()).filter(Boolean);
  const main = parts[0];
  if (!main) return null;
  const tokens = main
    .replace(/\b(topshird[ia]|topshirgan|qabul qildi|ga)\b/gi, ' ')
    .split(/[.\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  const surname = sorted[0]!;
  if (surname.length < 3) return null;
  const rest = tokens.filter((t) => t !== surname);
  const initial = rest[0] ?? '';
  return { surname, initial, others: parts.slice(1) };
}

export function matchEmployee(raw: string, emps: EmpRow[], prefer: { regionCode: number | null; departmentId: string | null }): { emp: EmpRow | null; reason: string } {
  const h = parseHolder(raw);
  if (!h) return { emp: null, reason: "ism o'qilmadi" };
  const sk = nameKey(h.surname);
  const ik = nameKey(h.initial);
  let list = emps.filter((e) => nameKey(e.lastName) === sk);
  if (!list.length) list = emps.filter((e) => nameKey(e.fullName.split(/\s+/)[0] ?? '') === sk);
  if (!list.length) return { emp: null, reason: 'xodimlar ro‘yxatida yo‘q' };
  if (ik) {
    const first = (e: EmpRow) => nameKey(e.firstName || e.fullName.split(/\s+/)[1] || '');
    let byInitial = list.filter((e) => first(e).startsWith(ik));
    // «S.» — Sardor (Sherzod emas: u «Sh.» deb yoziladi)
    if (ik.length === 1 && /[scgo]/.test(ik)) {
      const plain = byInitial.filter((e) => !first(e).startsWith(`${ik}h`));
      if (plain.length) byInitial = plain;
    }
    if (byInitial.length) list = byInitial;
    else return { emp: null, reason: `familiya bor, «${h.initial}» ismli yo‘q` };
  }
  if (list.length === 1) return { emp: list[0]!, reason: '' };
  const near = list.filter((e) => (prefer.departmentId ? e.departmentId === prefer.departmentId : prefer.regionCode !== null && e.regionCode === prefer.regionCode));
  if (near.length === 1) return { emp: near[0]!, reason: '' };
  return { emp: null, reason: `${list.length} ta bir xil xodim` };
}

@Injectable()
export class FixedAssetAdoptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: FixedAssetsService,
    private readonly audit: AuditService,
  ) {}

  private async load(batch?: string) {
    const where = { deletedAt: null, source: 'IMPORT', ...(batch ? { importBatch: batch } : {}) };
    const [rows, emps] = await Promise.all([
      this.prisma.fixedAsset.findMany({ where, orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.employee.findMany({ where: { isActive: true }, select: { pinfl: true, fullName: true, lastName: true, firstName: true, regionCode: true, departmentId: true } }),
    ]);
    return { rows, emps: emps as EmpRow[] };
  }

  private plan(rows: Awaited<ReturnType<FixedAssetAdoptService['load']>>['rows'], emps: EmpRow[]) {
    const todo = rows.filter((r) => !r.assetId);
    const holderCache = new Map<string, { emp: EmpRow | null; reason: string }>();
    const holders = new Map<string, { name: string; employee: string | null; pinfl: string | null; count: number }>();
    const unmatched = new Map<string, { name: string; count: number; reason: string }>();
    let matched = 0;
    let pieces = 0;
    const out = todo.map((r) => {
      const raw = r.holderName?.trim() ?? '';
      const key = `${raw}|${r.regionCode}|${r.departmentId}`;
      let m = holderCache.get(key);
      if (!m) {
        m = raw ? matchEmployee(raw, emps, { regionCode: r.regionCode, departmentId: r.departmentId }) : { emp: null, reason: 'qabul qiluvchi yozilmagan' };
        holderCache.set(key, m);
      }
      const qty = Math.max(1, r.quantity ?? 1);
      pieces += qty;
      if (m.emp) matched += qty;
      else if (raw) {
        const u = unmatched.get(raw) ?? { name: raw, count: 0, reason: m.reason };
        u.count += qty;
        unmatched.set(raw, u);
      }
      const hk = raw || '—';
      const h = holders.get(hk) ?? { name: hk, employee: m.emp?.fullName ?? null, pinfl: m.emp?.pinfl ?? null, count: 0 };
      h.count += qty;
      holders.set(hk, h);
      return { row: r, emp: m.emp, qty };
    });
    return {
      out,
      preview: {
        total: todo.length,
        pieces,
        matched,
        unmatched: [...unmatched.values()].sort((a, b) => b.count - a.count),
        holders: [...holders.values()].sort((a, b) => b.count - a.count),
        alreadyLinked: rows.length - todo.length,
      },
    };
  }

  /** Nima bo'lishini oldindan ko'rsatish (hech narsa yozilmaydi) */
  async preview(batch?: string): Promise<AdoptPreview> {
    const { rows, emps } = await this.load(batch);
    const { out, preview } = this.plan(rows, emps);
    const taken = new Set((await this.prisma.asset.findMany({ select: { inventoryNo: true } })).map((a) => a.inventoryNo));
    let renumbered = 0;
    for (const p of out) {
      for (let i = 0; i < p.qty; i++) {
        const inv = cleanInv(p.row.inventoryNo);
        if (inv && !taken.has(inv)) taken.add(inv);
        else renumbered += 1;
      }
    }
    return { ...preview, renumbered };
  }

  async adopt(batch: string | undefined, userId: string): Promise<AdoptResult> {
    const { rows, emps } = await this.load(batch);
    const { out, preview } = this.plan(rows, emps);
    if (!out.length) throw new BadRequestException(preview.alreadyLinked ? 'Bu partiyadagi hamma vosita allaqachon omborga ulangan' : "Ulanadigan vosita yo'q");

    // Ombor ma'lumotnomasi: bir xil nomli vositalar — bitta buyum (AV-xxxx)
    const items = await this.prisma.stockItem.findMany({ where: { kind: 'ASSET' }, select: { id: true, name: true, code: true, categoryCode: true } });
    const itemByName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i.id]));
    const lastCode = items.map((i) => Number(i.code.replace(/^AV-/, '')) || 0).reduce((a, b) => Math.max(a, b), 0);
    let codeNo = lastCode;
    let itemsCreated = 0;
    const itemFor = async (name: string, categoryCode: string): Promise<string> => {
      const k = name.trim().toLowerCase();
      const found = itemByName.get(k);
      if (found) return found;
      codeNo += 1;
      const created = await this.prisma.stockItem.create({
        data: { code: `AV-${String(codeNo).padStart(4, '0')}`, name: name.trim().slice(0, 300), unit: 'dona', kind: 'ASSET', categoryCode, group: 'Xodimlarga berilgan (import)' },
        select: { id: true },
      });
      itemByName.set(k, created.id);
      itemsCreated += 1;
      return created.id;
    };

    // Inventar raqamlari: fayldagisi bo'sh va takrorlanmagan bo'lsa — o'sha, aks holda «raqam-2», yoki INV-xxxxxx
    const taken = new Set((await this.prisma.asset.findMany({ select: { inventoryNo: true } })).map((a) => a.inventoryNo));
    const lastInv = [...taken].filter((x) => x.startsWith('INV-')).map((x) => Number(x.slice(4)) || 0).reduce((a, b) => Math.max(a, b), 0);
    let invNo = lastInv;
    let renumbered = 0;
    const numberFor = (raw: string | null): string => {
      const inv = cleanInv(raw);
      if (inv && !taken.has(inv)) {
        taken.add(inv);
        return inv;
      }
      renumbered += 1;
      if (inv) {
        for (let n = 2; n < 1000; n++) {
          const c = `${inv}-${n}`;
          if (!taken.has(c)) {
            taken.add(c);
            return c;
          }
        }
      }
      let c: string;
      do {
        invNo += 1;
        c = `INV-${String(invNo).padStart(6, '0')}`;
      } while (taken.has(c));
      taken.add(c);
      return c;
    };

    let created = 0;
    for (const p of out) {
      const r = p.row;
      const itemId = await itemFor(r.name, r.categoryCode);
      // Dona bo'yicha bo'lish: qiymat teng, qoldiq birinchisiga
      const per = r.costTiyin / BigInt(p.qty);
      const first = r.costTiyin - per * BigInt(p.qty - 1);
      const condition = /holati:\s*([^·]+)/i.exec(r.note ?? '')?.[1]?.trim() ?? 'Yangi';
      const holderName = p.emp?.fullName ?? r.holderName?.trim() ?? null;
      for (let i = 0; i < p.qty; i++) {
        const assetId = randomUUID().replace(/-/g, '').slice(0, 25);
        const inventoryNo = numberFor(r.inventoryNo);
        const price = i === 0 ? first : per;
        const ops = [
          this.prisma.asset.create({
            data: {
              id: assetId,
              inventoryNo,
              itemId,
              name: r.name,
              priceTiyin: price,
              acquiredAt: r.acquiredAt,
              status: 'IN_USE',
              departmentId: r.departmentId,
              regionCode: r.regionCode,
              holderPinfl: p.emp?.pinfl ?? null,
              holderName,
              note: [r.importBatch ? `Excel import: ${r.importBatch}` : 'Excel import', r.placeText ? `bo'lim (faylda): ${r.placeText}` : null].filter(Boolean).join(' · ').slice(0, 500),
            },
          }),
          this.prisma.assetMove.create({
            data: {
              assetId,
              kind: 'ISSUE',
              date: r.acquiredAt,
              toDepartmentId: r.departmentId,
              toRegionCode: r.regionCode,
              toHolderPinfl: p.emp?.pinfl ?? null,
              toHolderName: holderName,
              condition,
              note: `Boshlang'ich qoldiq — Excel'dan (qabul qiluvchi faylda: ${r.holderName ?? '—'})`.slice(0, 500),
              createdById: userId,
            },
          }),
        ];
        if (i === 0) {
          ops.push(
            this.prisma.fixedAsset.update({
              where: { id: r.id },
              data: { assetId, inventoryNo, costTiyin: first, quantity: 1, holderName },
            }) as never,
          );
        } else {
          ops.push(
            this.prisma.fixedAsset.create({
              data: {
                name: r.name,
                categoryCode: r.categoryCode,
                costTiyin: price,
                acquiredAt: r.acquiredAt,
                lifeMonths: r.lifeMonths,
                lifeOverridden: r.lifeOverridden,
                regionCode: r.regionCode,
                departmentId: r.departmentId,
                source: 'IMPORT',
                mode: r.mode,
                assetId,
                inventoryNo,
                holderName,
                placeText: r.placeText,
                quantity: 1,
                importBatch: r.importBatch,
                note: r.note,
                createdById: userId,
              },
            }) as never,
          );
        }
        await this.prisma.$transaction(ops);
        created += 1;
      }
    }
    await this.assets.sync().catch(() => null);
    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'fixed_asset',
      entityId: batch ?? 'IMPORT',
      summary: `Omborga ulandi: ${created} ta vosita${batch ? ` (partiya ${batch})` : ''}, xodimga bog'landi: ${preview.matched} ta`,
    });
    return { ...preview, renumbered, created, items: itemsCreated };
  }
}

function cleanInv(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || /^0+$/.test(v) || v.length < 2) return null;
  return v.slice(0, 60);
}