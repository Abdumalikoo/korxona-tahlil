import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runExclusive } from '../../common/locks';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Yuklangan manba fayllar arxivi va «bog'liqliklar».
//
// Muammo: yuklashda fayldan faqat o'sha paytdagi kerakli ma'lumot olinadi (masalan, tarkibdan — summalar).
// Keyin yangi bog'liqlik paydo bo'lsa (tarkibdagi bo'lim nomlari), eski yuklashlarni qayta yuklashga to'g'ri keladi.
//
// Yechim:
//  1) Har tahlil qilingan fayl arxivga olinadi (PENDING); saqlanganda o'sha yuklash (batch) bilan bog'lanadi (LINKED);
//     bekor qilinsa — CANCELLED (fayl o'chirilmaydi). Saqlanmagan tahlillar 48 soatdan keyin tozalanadi.
//  2) «Bog'liqlik» (linker) — fayldan qo'shimcha ma'lumot oluvchi qism (nomi + versiyasi). Yangi bog'liqlik yoki
//     yangi versiya qo'shilsa — API ishga tushganda arxivdagi hamma saqlangan fayllarga o'zi qo'llanadi;
//     yangi yuklashda — darhol. Natija har faylda yoziladi (qaysi bog'liqlik, qaysi versiya, qachon).
//
// Fayllar: SOURCE_ARCHIVE_DIR (standart — <api>/storage/source-files), har biri SHA-256 nomi bilan bir marta.
// APP_ENCRYPTION_KEY sozlangan bo'lsa — AES-256-GCM bilan shifrlanadi. Ro'yxat — settings «source.archive.<tur>».
// Fayllarda shaxsiy ma'lumot bor: ochiq yo'l yo'q, yuklab olish — faqat administrator, hammasi audit bilan.
// ═══════════════════════════════════════════════════════════

export const SOURCE_KINDS = ['salary-composition', 'payroll', 'unit-payroll', 'acc-23106', 'bank-analysis', 'invoice-analysis', 'regional-income', 'cashbook'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  'salary-composition': 'Ish haqi tarkibi',
  payroll: 'Soliq hisoboti (umumiy ish haqi)',
  'unit-payroll': "Bo'lim ish haqi vedomosti",
  'acc-23106': '23106 bank ko‘chirmasi',
  'bank-analysis': 'Bank ko‘chirmasi (tahlil)',
  'invoice-analysis': 'Schyot-fakturalar (tahlil)',
  'regional-income': 'Hududlar tushumi (xizmatlar bo‘yicha)',
  cashbook: 'Kassa: kunlik tushum ma’lumotnomasi',
};

export interface SourceLinkState {
  version: number;
  at: string;
  ok: boolean;
  note: string;
}

export interface SourceEntry {
  id: string;
  kind: SourceKind;
  sha256: string;
  fileName: string;
  size: number;
  sealed: boolean;
  status: 'PENDING' | 'LINKED' | 'CANCELLED';
  /** Yuklash oylari */
  periods: string[];
  /** Bo'lim (Tax free …) — bo'lim yuklashlari uchun */
  unit: string | null;
  /** Tahlilda tanlangan varaq */
  sheet: string | null;
  /** Bog'langan yuklash (batch) */
  refId: string | null;
  userId: string | null;
  at: string;
  linkedAt: string | null;
  cancelledAt: string | null;
  links: Record<string, SourceLinkState>;
}

export interface SourceLinker {
  kind: SourceKind;
  /** Bog'liqlik nomi (masalan, «depts») */
  name: string;
  /** Mantiq o'zgarsa — versiya oshiriladi, eski fayllarga qayta qo'llanadi */
  version: number;
  label: string;
  run: (entry: SourceEntry, file: { buffer: Buffer; originalname: string }) => Promise<{ ok: boolean; note: string }>;
}

const KEY = (kind: SourceKind) => `source.archive.${kind}`;
const MAX_ENTRIES = 5000;
const PENDING_TTL_MS = 48 * 3600 * 1000;
const LINK_WINDOW_MS = 24 * 3600 * 1000;
const MAGIC = Buffer.from('KTSF1\n');
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isSourceKind = (v: unknown): v is SourceKind => typeof v === 'string' && (SOURCE_KINDS as readonly string[]).includes(v);

function cipherKey(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY ?? '';
  if (raw.length < 32) return null;
  return Buffer.from(hkdfSync('sha256', Buffer.from(raw, 'utf8'), Buffer.from('korxona-tahlil'), Buffer.from('source-archive:v1'), 32));
}

@Injectable()
export class SourceArchiveService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SourceArchiveService.name);
  private readonly linkers = new Map<string, SourceLinker>();
  private backfilling: Promise<unknown> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get dir(): string {
    return resolve(process.env.SOURCE_ARCHIVE_DIR ?? join(process.cwd(), 'storage', 'source-files'));
  }

  private filePath(kind: SourceKind, sha: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new BadRequestException("Fayl identifikatori noto'g'ri");
    return join(this.dir, kind, `${sha}.bin`);
  }

  // ─────────── Ro'yxat ───────────

  private async entries(kind: SourceKind): Promise<SourceEntry[]> {
    const v = (await this.prisma.setting.findUnique({ where: { key: KEY(kind) } }))?.value as { entries?: unknown } | null;
    return Array.isArray(v?.entries) ? (v!.entries as SourceEntry[]).filter((e) => e && typeof e.id === 'string') : [];
  }

  private async save(kind: SourceKind, list: SourceEntry[]) {
    const key = KEY(kind);
    const value = { entries: list.slice(-MAX_ENTRIES) } as unknown as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  private async mutate<T>(kind: SourceKind, fn: (list: SourceEntry[]) => Promise<T> | T): Promise<T> {
    return runExclusive(`setting:${KEY(kind)}`, async () => {
      const list = await this.entries(kind);
      const out = await fn(list);
      await this.save(kind, list);
      return out;
    });
  }

  // ─────────── Fayl ───────────

  private async writeBlob(kind: SourceKind, buffer: Buffer): Promise<{ sha: string; sealed: boolean }> {
    const sha = createHash('sha256').update(buffer).digest('hex');
    const p = this.filePath(kind, sha);
    await mkdir(join(this.dir, kind), { recursive: true, mode: 0o700 });
    const k = cipherKey();
    let body: Buffer = buffer;
    if (k) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', k, iv);
      const enc = Buffer.concat([c.update(buffer), c.final()]);
      body = Buffer.concat([MAGIC, iv, enc, c.getAuthTag()]);
    }
    await writeFile(p, body, { mode: 0o600 });
    return { sha, sealed: Boolean(k) };
  }

  /** Arxivdagi faylni o'qish (shifrlangan bo'lsa — ochiladi, SHA-256 tekshiriladi) */
  async read(entry: SourceEntry): Promise<Buffer> {
    let raw: Buffer;
    try {
      raw = await readFile(this.filePath(entry.kind, entry.sha256));
    } catch {
      throw new NotFoundException(`«${entry.fileName}» fayli arxivda topilmadi`);
    }
    let buf = raw;
    if (raw.subarray(0, MAGIC.length).equals(MAGIC)) {
      const k = cipherKey();
      if (!k) throw new BadRequestException('Arxiv fayli shifrlangan, lekin APP_ENCRYPTION_KEY sozlanmagan');
      const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
      const tag = raw.subarray(raw.length - 16);
      const d = createDecipheriv('aes-256-gcm', k, iv);
      d.setAuthTag(tag);
      try {
        buf = Buffer.concat([d.update(raw.subarray(MAGIC.length + 12, raw.length - 16)), d.final()]);
      } catch {
        throw new BadRequestException('Arxiv faylini ochib bo‘lmadi — APP_ENCRYPTION_KEY almashtirilgan bo‘lishi mumkin');
      }
    }
    if (createHash('sha256').update(buf).digest('hex') !== entry.sha256) throw new BadRequestException(`«${entry.fileName}» arxiv fayli buzilgan`);
    return buf;
  }

  // ─────────── Yuklash oqimi ───────────

  /** Tahlil qilingan fayl — saqlanguncha kutadi (PENDING). Xato bo'lsa — yuklash to'xtamaydi */
  async hold(kind: SourceKind, file: Express.Multer.File | undefined, meta: { userId?: string | null; periods?: string[]; unit?: string | null; sheet?: string | null }): Promise<SourceEntry | null> {
    if (!file?.buffer?.length) return null;
    try {
      const { sha, sealed } = await this.writeBlob(kind, file.buffer);
      const entry: SourceEntry = {
        id: randomUUID(),
        kind,
        sha256: sha,
        fileName: String(file.originalname ?? 'fayl.xlsx').slice(0, 200),
        size: file.buffer.length,
        sealed,
        status: 'PENDING',
        periods: (meta.periods ?? []).filter((p) => PERIOD_RE.test(p)),
        unit: meta.unit ?? null,
        sheet: meta.sheet ?? null,
        refId: null,
        userId: meta.userId ?? null,
        at: new Date().toISOString(),
        linkedAt: null,
        cancelledAt: null,
        links: {},
      };
      await this.mutate(kind, (list) => {
        list.push(entry);
      });
      await this.prune(kind).catch(() => null);
      return entry;
    } catch (e) {
      this.logger.warn(`Manba fayl arxivga olinmadi (${kind}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Saqlandi: shu foydalanuvchining shu nomli oxirgi tahlil qilingan fayli shu yuklash bilan bog'lanadi va
   * bog'liqliklar darhol qo'llanadi. Fayl topilmasa — null (yuklashga ta'sir qilmaydi).
   */
  async link(kind: SourceKind, meta: { userId?: string | null; fileName?: string | null; refId: string; periods?: string[]; unit?: string | null }): Promise<SourceEntry | null> {
    try {
      const now = Date.now();
      const linked = await this.mutate(kind, (list) => {
        const cand = list
          .filter((e) => e.status === 'PENDING' && (!meta.userId || e.userId === meta.userId) && (meta.unit ?? null) === (e.unit ?? null) && now - Date.parse(e.at) < LINK_WINDOW_MS)
          .sort((a, b) => b.at.localeCompare(a.at));
        let e = cand.find((x) => meta.fileName && x.fileName === meta.fileName) ?? (cand.length === 1 ? cand[0] : undefined);
        if (!e && meta.fileName) {
          // Bitta fayldan bir necha oy (yoki yuklash) saqlanmoqda — o'sha fayl keyingi yuklashga ham bog'lanadi
          const prev = list
            .filter((x) => x.status === 'LINKED' && x.fileName === meta.fileName && x.refId !== meta.refId && (!meta.userId || x.userId === meta.userId) && (meta.unit ?? null) === (x.unit ?? null) && x.linkedAt && now - Date.parse(x.linkedAt) < 3600 * 1000)
            .sort((a, b) => (b.linkedAt ?? '').localeCompare(a.linkedAt ?? ''))[0];
          if (prev) {
            e = { ...prev, id: randomUUID(), links: {}, periods: [] };
            list.push(e);
          }
        }
        if (!e) return null;
        e.status = 'LINKED';
        e.refId = meta.refId;
        e.linkedAt = new Date().toISOString();
        if (meta.periods?.length) e.periods = meta.periods.filter((p) => PERIOD_RE.test(p));
        return { ...e };
      });
      if (linked) await this.runLinkers(linked);
      return linked;
    } catch (e) {
      this.logger.warn(`Manba fayl bog'lanmadi (${kind}): ${(e as Error).message}`);
      return null;
    }
  }

  /** Oldin saqlangan yuklashga faylni keyin biriktirish (arxivdan oldingi yuklashlar uchun) */
  async attach(kind: SourceKind, file: Express.Multer.File, meta: { userId?: string | null; refId: string; periods: string[]; unit?: string | null; sheet?: string | null }): Promise<SourceEntry | null> {
    const held = await this.hold(kind, file, meta);
    if (!held) return null;
    return this.mutate(kind, (list) => {
      // Shu yuklashning oldingi fayli bo'lsa — almashtiriladi
      for (const e of list) if (e.status === 'LINKED' && e.refId === meta.refId && e.id !== held.id) e.status = 'CANCELLED';
      const e = list.find((x) => x.id === held.id);
      if (!e) return null;
      e.status = 'LINKED';
      e.refId = meta.refId;
      e.linkedAt = new Date().toISOString();
      return { ...e };
    });
  }

  /**
   * Saqlangan yuklashning fayli: bog'langan bo'lsa — o'sha; bo'lmasa (saqlashda bog'lanmay qolgan) — shu oy, shu nomli
   * kutayotgan tahlil fayli shu yuklashga bog'lanadi va bog'liqliklar qo'llanadi. Topilmasa — null (fayl arxivda yo'q).
   */
  async adopt(kind: SourceKind, q: { period: string; refId: string; fileName?: string | null; unit?: string | null }): Promise<SourceEntry | null> {
    const linked = await this.find(kind, { refId: q.refId });
    if (linked) {
      const links = await this.runLinkers(linked);
      return { ...linked, links };
    }
    const adopted = await this.mutate(kind, (list) => {
      const cand = list
        .filter((e) => e.status === 'PENDING' && e.periods.includes(q.period) && (e.unit ?? null) === (q.unit ?? null) && (!q.fileName || e.fileName === q.fileName))
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      if (!cand) return null;
      cand.status = 'LINKED';
      cand.refId = q.refId;
      cand.linkedAt = new Date().toISOString();
      return { ...cand };
    });
    if (!adopted) return null;
    const links = await this.runLinkers(adopted);
    return { ...adopted, links };
  }

  /** Yuklash bekor qilindi — fayl arxivda qoladi, holati CANCELLED */
  async cancel(kind: SourceKind, refId: string): Promise<number> {
    try {
      return await this.mutate(kind, (list) => {
        let n = 0;
        for (const e of list)
          if (e.refId === refId && e.status === 'LINKED') {
            e.status = 'CANCELLED';
            e.cancelledAt = new Date().toISOString();
            n += 1;
          }
        return n;
      });
    } catch {
      return 0;
    }
  }

  /** Shu yuklash (yoki oy) uchun saqlangan fayl */
  async find(kind: SourceKind, q: { refId?: string; period?: string; unit?: string | null }): Promise<SourceEntry | null> {
    const list = (await this.entries(kind)).filter((e) => e.status === 'LINKED' && (!q.refId || e.refId === q.refId) && (!q.period || e.periods.includes(q.period)) && (q.unit === undefined || (e.unit ?? null) === (q.unit ?? null)));
    return list.sort((a, b) => (b.linkedAt ?? b.at).localeCompare(a.linkedAt ?? a.at))[0] ?? null;
  }

  /** Saqlanmagan tahlillar (48 soatdan eski) — ro'yxatdan va diskdan (boshqa yozuv ishlatmasa) */
  private async prune(kind: SourceKind) {
    const now = Date.now();
    const dropped = await this.mutate(kind, (list) => {
      const out: SourceEntry[] = [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const e = list[i]!;
        if (e.status === 'PENDING' && now - Date.parse(e.at) > PENDING_TTL_MS) out.push(...list.splice(i, 1));
      }
      const used = new Set(list.map((e) => e.sha256));
      return out.filter((e) => !used.has(e.sha256));
    });
    for (const e of dropped) await rm(this.filePath(kind, e.sha256), { force: true }).catch(() => null);
  }

  // ─────────── Bog'liqliklar ───────────

  register(linker: SourceLinker) {
    this.linkers.set(`${linker.kind}:${linker.name}`, linker);
  }

  linkersOf(kind: SourceKind): SourceLinker[] {
    return [...this.linkers.values()].filter((l) => l.kind === kind);
  }

  /** Bitta faylga — qo'llanmagan (yoki eski versiyadagi) bog'liqliklar; force — hammasi qaytadan */
  async runLinkers(entry: SourceEntry, force = false): Promise<Record<string, SourceLinkState>> {
    const todo = this.linkersOf(entry.kind).filter((l) => force || entry.links?.[l.name]?.version !== l.version || entry.links?.[l.name]?.ok === false);
    if (!todo.length || entry.status !== 'LINKED') return entry.links ?? {};
    let buffer: Buffer;
    try {
      buffer = await this.read(entry);
    } catch (e) {
      const state = { version: 0, at: new Date().toISOString(), ok: false, note: (e as Error).message };
      await this.setLinks(entry, Object.fromEntries(todo.map((l) => [l.name, state])));
      return { ...entry.links, ...Object.fromEntries(todo.map((l) => [l.name, state])) };
    }
    const result: Record<string, SourceLinkState> = {};
    for (const l of todo) {
      try {
        const r = await l.run(entry, { buffer, originalname: entry.fileName });
        result[l.name] = { version: l.version, at: new Date().toISOString(), ok: r.ok, note: r.note.slice(0, 300) };
      } catch (e) {
        result[l.name] = { version: l.version, at: new Date().toISOString(), ok: false, note: ((e as Error).message ?? 'xato').slice(0, 300) };
      }
    }
    await this.setLinks(entry, result);
    return { ...entry.links, ...result };
  }

  private async setLinks(entry: SourceEntry, links: Record<string, SourceLinkState>) {
    await this.mutate(entry.kind, (list) => {
      const e = list.find((x) => x.id === entry.id);
      if (e) e.links = { ...(e.links ?? {}), ...links };
    });
  }

  /** Arxivdagi hamma saqlangan fayllarga bog'liqliklarni qo'llash (yangi yoki yangilangan bog'liqliklar) */
  async backfill(kind?: SourceKind, force = false): Promise<{ files: number; runs: number; failed: number }> {
    let files = 0;
    let runs = 0;
    let failed = 0;
    for (const k of kind ? [kind] : SOURCE_KINDS) {
      if (!this.linkersOf(k).length) continue;
      for (const e of (await this.entries(k)).filter((x) => x.status === 'LINKED')) {
        const before = JSON.stringify(e.links ?? {});
        const links = await this.runLinkers(e, force);
        if (JSON.stringify(links) !== before) {
          files += 1;
          runs += Object.keys(links).length;
          failed += Object.values(links).filter((s) => !s.ok).length;
        }
      }
    }
    return { files, runs, failed };
  }

  onApplicationBootstrap() {
    // Ishga tushishni kutdirmaydi: yangi bog'liqliklar eski fayllarga orqada qo'llanadi
    if (process.env.NODE_ENV === 'test' || process.env.SOURCE_ARCHIVE_BACKFILL === 'off') return;
    setTimeout(() => {
      this.backfilling = this.backfill()
        .then((r) => r.files && this.logger.log(`Arxiv: ${r.files} faylga bog'liqliklar qo'llandi${r.failed ? ` (${r.failed} tasi xato)` : ''}`))
        .catch((e) => this.logger.warn(`Arxiv bog'liqliklari qo'llanmadi: ${(e as Error).message}`))
        .finally(() => (this.backfilling = null));
    }, 8000).unref?.();
  }

  // ─────────── Ko'rish ───────────

  async list(kind?: SourceKind, period?: string) {
    const out: (SourceEntry & { kindLabel: string })[] = [];
    for (const k of kind ? [kind] : SOURCE_KINDS) {
      for (const e of await this.entries(k)) {
        if (e.status === 'PENDING') continue;
        if (period && !e.periods.includes(period)) continue;
        out.push({ ...e, kindLabel: SOURCE_KIND_LABEL[k] });
      }
    }
    const linkers = Object.fromEntries(SOURCE_KINDS.map((k) => [k, this.linkersOf(k).map((l) => ({ name: l.name, label: l.label, version: l.version }))]));
    return { directory: this.dir.split(/[\\/]/).slice(-2).join('/'), encrypted: Boolean(cipherKey()), entries: out.sort((a, b) => (b.linkedAt ?? b.at).localeCompare(a.linkedAt ?? a.at)), linkers, running: Boolean(this.backfilling) };
  }

  async get(kind: SourceKind, id: string): Promise<SourceEntry> {
    const e = (await this.entries(kind)).find((x) => x.id === id && x.status !== 'PENDING');
    if (!e) throw new NotFoundException('Fayl topilmadi');
    return e;
  }
}
