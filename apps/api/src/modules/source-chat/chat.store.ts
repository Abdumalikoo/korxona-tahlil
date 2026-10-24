import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { ChatAnswer } from './chat.service';
import { listBlock, shapeOf } from '../../common/settings/shape';

// ═══════════════════════════════════════════════════════════
// Manba chati — suhbatlar va saqlanganlar (har foydalanuvchiniki alohida, `settings`da; migratsiya kerak emas):
//   chat.source.<u>.index    — suhbatlar ro'yxati (nomi, qadalgan, vaqtlari, savollar soni)
//   chat.source.<u>.t.<id>   — bitta suhbatning savol-javoblari
//   chat.source.<u>.saved    — saqlangan javoblar (izoh bilan; suhbat o'chirilsa ham qoladi)
// Eski «chat.source.<u>» (bitta tarix) birinchi ochilishda «Avvalgi suhbat» bo'lib ko'chadi.
// ═══════════════════════════════════════════════════════════

export const MAX_THREADS = 100;
export const MAX_ITEMS = 200;
export const MAX_SAVED = 300;

export interface ThreadMeta {
  id: string;
  title: string;
  /** Nomini foydalanuvchi o'zi qo'ygan (avtomatik nom almashtirilmaydi) */
  titled: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  count: number;
}

export interface SavedAnswer {
  id: string;
  note: string | null;
  savedAt: string;
  threadId: string | null;
  threadTitle: string | null;
  answer: ChatAnswer;
}

const autoTitle = (q: string) => {
  const s = q.replace(/\s+/g, ' ').trim();
  return s.length > 60 ? `${s.slice(0, 57)}…` : s || 'Yangi suhbat';
};

export class ChatStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly user: string,
  ) {}

  private k(suffix: string) {
    return `chat.source.${this.user}.${suffix}`;
  }

  /** O'qish + tashqi tuzilma tekshiruvi: {threads|items: [...]} bo'lmasa — xato (ustidan yozilmaydi) */
  private async read<T>(key: string): Promise<T | null> {
    const raw = (await this.prisma.setting.findUnique({ where: { key } }))?.value ?? null;
    const field = key.endsWith('.index') ? 'threads' : 'items';
    return shapeOf(key, raw, listBlock(field).partial()) as T | null;
  }

  private async write(key: string, value: unknown) {
    const v = value as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  private async remove(keys: string[]) {
    if (keys.length) await this.prisma.setting.deleteMany({ where: { key: { in: keys } } });
  }

  // ─────────── Suhbatlar ───────────

  async threads(): Promise<ThreadMeta[]> {
    let idx = await this.read<{ threads?: ThreadMeta[] }>(this.k('index'));
    if (!idx) {
      // Eski bitta tarixdan ko'chirish
      const legacyKey = `chat.source.${this.user}`;
      const legacy = await this.read<{ items?: ChatAnswer[] }>(legacyKey);
      const threads: ThreadMeta[] = [];
      if (legacy?.items?.length) {
        const id = randomUUID();
        const items = legacy.items.slice(-MAX_ITEMS);
        await this.write(this.k(`t.${id}`), { items });
        threads.push({ id, title: 'Avvalgi suhbat', titled: true, pinned: false, createdAt: items[0]!.at, updatedAt: items[items.length - 1]!.at, count: items.length });
      }
      idx = { threads };
      await this.write(this.k('index'), idx);
      if (legacy) await this.remove([legacyKey]);
    }
    return Array.isArray(idx.threads) ? idx.threads : [];
  }

  private async saveIndex(threads: ThreadMeta[]) {
    await this.write(this.k('index'), { threads });
  }

  /** Ro'yxat: qadalganlar tepada, keyin oxirgi o'zgargani */
  async list(q?: string): Promise<ThreadMeta[]> {
    const s = (q ?? '').trim().toLowerCase();
    return (await this.threads())
      .filter((t) => !s || t.title.toLowerCase().includes(s))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(title?: unknown): Promise<ThreadMeta> {
    const threads = await this.threads();
    if (threads.length >= MAX_THREADS) {
      // Eng eski qadalmagan suhbat o'chadi
      const old = [...threads].filter((t) => !t.pinned).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
      if (!old) throw new BadRequestException(`Ko'pi bilan ${MAX_THREADS} ta suhbat — keraksizlarini o'chiring`);
      await this.delete(old.id);
      return this.create(title);
    }
    const now = new Date().toISOString();
    const t: ThreadMeta = {
      id: randomUUID(),
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : 'Yangi suhbat',
      titled: typeof title === 'string' && Boolean(title.trim()),
      pinned: false,
      createdAt: now,
      updatedAt: now,
      count: 0,
    };
    await this.saveIndex([...threads, t]);
    await this.write(this.k(`t.${t.id}`), { items: [] });
    return t;
  }

  private async meta(id: string): Promise<{ threads: ThreadMeta[]; t: ThreadMeta }> {
    const threads = await this.threads();
    const t = threads.find((x) => x.id === id);
    if (!t) throw new NotFoundException('Suhbat topilmadi');
    return { threads, t };
  }

  async items(id: string): Promise<ChatAnswer[]> {
    const v = await this.read<{ items?: ChatAnswer[] }>(this.k(`t.${id}`));
    return Array.isArray(v?.items) ? v!.items : [];
  }

  async get(id: string) {
    const { t } = await this.meta(id);
    return { ...t, items: await this.items(id) };
  }

  async append(id: string, a: ChatAnswer): Promise<ThreadMeta> {
    const { threads, t } = await this.meta(id);
    const items = [...(await this.items(id)), a].slice(-MAX_ITEMS);
    await this.write(this.k(`t.${id}`), { items });
    t.updatedAt = a.at;
    t.count = items.length;
    if (!t.titled && items.length === 1) t.title = autoTitle(a.question);
    await this.saveIndex(threads);
    return t;
  }

  async update(id: string, body: { title?: unknown; pinned?: unknown }): Promise<ThreadMeta> {
    const { threads, t } = await this.meta(id);
    if (typeof body?.title === 'string') {
      const title = body.title.replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!title) throw new BadRequestException("Nomi bo'sh bo'lmasin");
      t.title = title;
      t.titled = true;
    }
    if (typeof body?.pinned === 'boolean') t.pinned = body.pinned;
    await this.saveIndex(threads);
    return t;
  }

  /** Suhbat ichini tozalash (suhbat o'zi qoladi) */
  async clear(id: string): Promise<ThreadMeta> {
    const { threads, t } = await this.meta(id);
    await this.write(this.k(`t.${id}`), { items: [] });
    t.count = 0;
    t.updatedAt = new Date().toISOString();
    await this.saveIndex(threads);
    return t;
  }

  /** Bitta savol-javobni o'chirish */
  async removeItem(id: string, itemId: string): Promise<ThreadMeta> {
    const { threads, t } = await this.meta(id);
    const items = await this.items(id);
    const next = items.filter((x) => x.id !== itemId);
    if (next.length === items.length) throw new NotFoundException('Javob topilmadi');
    await this.write(this.k(`t.${id}`), { items: next });
    t.count = next.length;
    await this.saveIndex(threads);
    return t;
  }

  async delete(id: string) {
    const { threads } = await this.meta(id);
    await this.saveIndex(threads.filter((x) => x.id !== id));
    await this.remove([this.k(`t.${id}`)]);
    return { success: true as const };
  }

  /** Hamma suhbatlarni o'chirish (qadalganlar va saqlanganlar — so'ralsa) */
  async deleteAll(opts: { keepPinned?: boolean } = {}) {
    const threads = await this.threads();
    const drop = threads.filter((t) => !(opts.keepPinned && t.pinned));
    await this.remove(drop.map((t) => this.k(`t.${t.id}`)));
    await this.saveIndex(threads.filter((t) => opts.keepPinned && t.pinned));
    return { success: true as const, deleted: drop.length };
  }

  // ─────────── Saqlanganlar ───────────

  async saved(): Promise<SavedAnswer[]> {
    const v = await this.read<{ items?: SavedAnswer[] }>(this.k('saved'));
    return Array.isArray(v?.items) ? v!.items : [];
  }

  async save(body: { threadId?: unknown; itemId?: unknown; note?: unknown }): Promise<SavedAnswer> {
    const threadId = typeof body?.threadId === 'string' ? body.threadId : '';
    const itemId = typeof body?.itemId === 'string' ? body.itemId : '';
    const { t } = await this.meta(threadId);
    const a = (await this.items(threadId)).find((x) => x.id === itemId);
    if (!a) throw new NotFoundException('Javob topilmadi');
    const list = await this.saved();
    const dup = list.find((s) => s.answer.id === a.id);
    if (dup) return dup;
    if (list.length >= MAX_SAVED) throw new BadRequestException(`Ko'pi bilan ${MAX_SAVED} ta saqlangan javob — keraksizlarini o'chiring`);
    const s: SavedAnswer = {
      id: randomUUID(),
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null,
      savedAt: new Date().toISOString(),
      threadId,
      threadTitle: t.title,
      answer: a,
    };
    await this.write(this.k('saved'), { items: [s, ...list] });
    return s;
  }

  async updateSaved(id: string, body: { note?: unknown }): Promise<SavedAnswer> {
    const list = await this.saved();
    const s = list.find((x) => x.id === id);
    if (!s) throw new NotFoundException('Saqlangan javob topilmadi');
    if (body && 'note' in body) s.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    await this.write(this.k('saved'), { items: list });
    return s;
  }

  async unsave(id: string) {
    const list = await this.saved();
    const next = list.filter((x) => x.id !== id && x.answer.id !== id);
    if (next.length === list.length) throw new NotFoundException('Saqlangan javob topilmadi');
    await this.write(this.k('saved'), { items: next });
    return { success: true as const };
  }

  async clearSaved() {
    await this.remove([this.k('saved')]);
    return { success: true as const };
  }
}