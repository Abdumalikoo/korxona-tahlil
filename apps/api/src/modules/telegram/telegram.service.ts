import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Telegram bot: korxona topshiriqlarini xodimlarga yuboradi.
//   • token — Sozlamalar › Telegram (BotFather bergan), «settings» jadvalida saqlanadi;
//   • xodim bir marta shaxsiy havolani ochib «Start» bosadi → chat xodimga bog'lanadi;
//   • server botdan yangi xabarlarni o'zi so'rab turadi (long polling) — tashqaridan kirish,
//     domen yoki ochiq port shart emas, faqat serverdan api.telegram.org ga chiqish kerak.
// ═══════════════════════════════════════════════════════════

const KEY = 'telegram.bot';
const LINK_DAYS = 7;
const API = 'https://api.telegram.org';

export interface TelegramStatus {
  configured: boolean;
  username: string | null;
  polling: boolean;
  lastError: string | null;
  linked: number;
}

interface TgMessage {
  chat: { id: number; type?: string };
  from?: { username?: string; first_name?: string };
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

/** HTML belgilarini qochirish (parse_mode: HTML) */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Telegram');
  private token: string | null = null;
  private username: string | null = null;
  private polling = false;
  /** Har ishga tushirishda yangi — eski sikl o'zini to'xtatadi */
  private generation = 0;
  private offset = 0;
  private lastError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
      const value = (row?.value ?? null) as { token?: string; username?: string } | null;
      if (value?.token) {
        this.token = value.token;
        this.username = value.username ?? null;
        this.startPolling();
      }
    } catch (error) {
      this.lastError = (error as Error).message;
    }
  }

  onModuleDestroy(): void {
    this.stopPolling();
  }

  get configured(): boolean {
    return Boolean(this.token);
  }

  // ═══════════ Telegram API ═══════════

  private async call<T>(method: string, body: Record<string, unknown> = {}, token = this.token, timeoutMs = 15_000): Promise<T> {
    if (!token) throw new BadRequestException('Telegram bot ulanmagan (Sozlamalar › Telegram)');
    let res: Response;
    try {
      res = await fetch(`${API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`Telegram'ga ulanib bo'lmadi: serverdan api.telegram.org ga internet chiqishini tekshiring (${(error as Error).message})`);
    }
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!json?.ok) throw new Error(json?.description ?? `Telegram xatosi (${res.status})`);
    return json.result as T;
  }

  /** Xabar yuborish (HTML) */
  async send(chatId: string, html: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
  }

  // ═══════════ Sozlash ═══════════

  async status(): Promise<TelegramStatus> {
    const linked = await this.prisma.telegramLink.count();
    return { configured: this.configured, username: this.username, polling: this.polling, lastError: this.lastError, linked };
  }

  /** Tokenni tekshirib saqlash (getMe) va xabarlarni qabul qilishni boshlash */
  async setToken(raw: unknown, userId: string): Promise<TelegramStatus> {
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new BadRequestException("Token noto'g'ri. BotFather bergan to'liq tokenni qo'ying (masalan 123456789:AAH...)");
    let me: { username?: string };
    try {
      me = await this.call<{ username?: string }>('getMe', {}, token);
    } catch (error) {
      throw new BadRequestException(`Token ishlamadi: ${(error as Error).message}`);
    }
    // Webhook o'rnatilgan bo'lsa — long polling ishlamaydi
    await this.call('deleteWebhook', { drop_pending_updates: false }, token).catch(() => undefined);
    const value = { token, username: me.username ?? null };
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    this.stopPolling();
    this.token = token;
    this.username = value.username;
    this.lastError = null;
    this.startPolling();
    await this.audit.log({ userId, action: 'UPDATE', entity: 'telegram', entityId: 'bot', summary: `Telegram bot ulandi: @${value.username ?? '?'}` });
    return this.status();
  }

  async clearToken(userId: string): Promise<TelegramStatus> {
    this.stopPolling();
    this.token = null;
    this.username = null;
    await this.prisma.setting.deleteMany({ where: { key: KEY } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'telegram', entityId: 'bot', summary: "Telegram bot uzildi" });
    return this.status();
  }

  // ═══════════ Xodimni ulash ═══════════

  /** Shaxsiy havola: xodim ochib «Start» bosadi */
  async createLink(pinfl: string): Promise<{ url: string; code: string; expiresAt: string }> {
    if (!this.configured || !this.username) throw new BadRequestException('Avval Telegram botni ulang (Sozlamalar › Telegram)');
    const employee = await this.prisma.employee.findUnique({ where: { pinfl }, select: { pinfl: true } });
    if (!employee) throw new NotFoundException('Xodim topilmadi');
    const code = randomBytes(9).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
    await this.prisma.telegramLinkCode.create({ data: { code, pinfl, expiresAt } });
    return { url: `https://t.me/${this.username}?start=${code}`, code, expiresAt: expiresAt.toISOString() };
  }

  async unlink(pinfl: string, userId: string): Promise<{ pinfl: string }> {
    await this.prisma.telegramLink.deleteMany({ where: { pinfl } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'telegram', entityId: pinfl, summary: 'Xodim Telegramdan uzildi' });
    return { pinfl };
  }

  async links(): Promise<{ pinfl: string; fullName: string; position: string | null; username: string | null; firstName: string | null; linkedAt: string }[]> {
    const rows = await this.prisma.telegramLink.findMany({ orderBy: { linkedAt: 'desc' } });
    const people = rows.length
      ? await this.prisma.employee.findMany({ where: { pinfl: { in: rows.map((r) => r.pinfl) } }, select: { pinfl: true, fullName: true, position: true } })
      : [];
    const byPinfl = new Map(people.map((p) => [p.pinfl, p]));
    return rows.map((r) => ({
      pinfl: r.pinfl,
      fullName: byPinfl.get(r.pinfl)?.fullName ?? r.pinfl,
      position: byPinfl.get(r.pinfl)?.position ?? null,
      username: r.username,
      firstName: r.firstName,
      linkedAt: r.linkedAt.toISOString(),
    }));
  }

  /** Sinov xabari */
  async test(pinfl: string): Promise<{ ok: true }> {
    const link = await this.prisma.telegramLink.findUnique({ where: { pinfl } });
    if (!link) throw new BadRequestException('Xodim hali botga ulanmagan');
    try {
      await this.send(link.chatId, '✅ Sinov xabari: korxona topshiriqlari shu yerga keladi.');
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return { ok: true };
  }

  // ═══════════ Xabarlarni qabul qilish (long polling) ═══════════

  private startPolling(): void {
    if (!this.token) return;
    const gen = ++this.generation;
    this.polling = true;
    void this.loop(gen);
  }

  private stopPolling(): void {
    this.generation += 1;
    this.polling = false;
  }

  private async loop(gen: number): Promise<void> {
    while (gen === this.generation && this.token) {
      try {
        const updates = await this.call<TgUpdate[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] }, this.token, 35_000);
        if (gen !== this.generation) return;
        this.lastError = null;
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message) await this.handle(update.message).catch((e) => this.log.warn((e as Error).message));
        }
      } catch (error) {
        if (gen !== this.generation) return;
        this.lastError = (error as Error).message;
        await sleep(10_000);
      }
    }
  }

  /** Botga kelgan xabar: /start <kod> — ulanish; /topshiriqlar — ochiq ishlar */
  async handle(msg: TgMessage): Promise<void> {
    const chatId = String(msg.chat.id);
    const text = (msg.text ?? '').trim();
    if (msg.chat.type && msg.chat.type !== 'private') return;

    const start = /^\/start(?:\s+(\S+))?$/.exec(text);
    if (start) {
      const code = start[1];
      if (!code) {
        await this.send(chatId, "Assalomu alaykum! Bu bot korxona topshiriqlarini yuboradi.\nUlanish uchun rahbaringiz bergan <b>shaxsiy havolani</b> oching.");
        return;
      }
      const row = await this.prisma.telegramLinkCode.findUnique({ where: { code } });
      if (!row || row.expiresAt < new Date()) {
        await this.send(chatId, "Havola eskirgan yoki noto'g'ri. Rahbaringizdan yangi havola so'rang.");
        return;
      }
      const employee = await this.prisma.employee.findUnique({ where: { pinfl: row.pinfl }, select: { fullName: true } });
      await this.prisma.telegramLink.upsert({
        where: { pinfl: row.pinfl },
        create: { pinfl: row.pinfl, chatId, username: msg.from?.username ?? null, firstName: msg.from?.first_name ?? null },
        update: { chatId, username: msg.from?.username ?? null, firstName: msg.from?.first_name ?? null, linkedAt: new Date() },
      });
      await this.prisma.telegramLinkCode.deleteMany({ where: { pinfl: row.pinfl } });
      await this.send(chatId, `✅ Ulandingiz: <b>${esc(employee?.fullName ?? '')}</b>\nSizga beriladigan topshiriqlar va muddat eslatmalari shu yerga keladi.\n\nOchiq topshiriqlaringiz: /topshiriqlar`);
      return;
    }

    const links = await this.prisma.telegramLink.findMany({ where: { chatId } });
    if (links.length === 0) {
      await this.send(chatId, 'Siz hali ulanmagansiz. Rahbaringiz bergan shaxsiy havolani oching.');
      return;
    }
    if (/^\/(topshiriqlar|tasks)$/i.test(text)) {
      const tasks = await this.prisma.task.findMany({
        where: { pinfl: { in: links.map((l) => l.pinfl) }, status: 'OPEN' },
        orderBy: { deadline: 'asc' },
        take: 20,
      });
      if (tasks.length === 0) {
        await this.send(chatId, "Ochiq topshiriq yo'q ✅");
        return;
      }
      const lines = tasks.map((t, i) => `${i + 1}. <b>${esc(t.title)}</b> — ${fmtDeadline(t.deadline)}`);
      await this.send(chatId, `📋 Ochiq topshiriqlaringiz:\n\n${lines.join('\n')}`);
      return;
    }
    await this.send(chatId, 'Topshiriqlar va eslatmalar shu yerga avtomatik keladi.\nOchiq topshiriqlaringiz: /topshiriqlar');
  }
}

/** "15.10.2026, 18:00" — Toshkent vaqti */
export function fmtDeadline(date: Date): string {
  const t = new Date(date.getTime() + 5 * 3600_000).toISOString();
  return `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}, ${t.slice(11, 16)}`;
}