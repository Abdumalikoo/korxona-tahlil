import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { esc, TelegramService } from '../telegram/telegram.service';
import { WarehouseActs } from './warehouse.acts';
import { WarehouseService } from './warehouse.service';
import { personName, WarehouseTemplates } from './warehouse.template';
import type { ActModel, ActSignInfo, DocView } from './warehouse.types';

// ═══════════════════════════════════════════════════════════
// Dalolatnomani elektron tasdiqlash.
//   1) Omborchi hujjatda «Rasmiylashtirish» bosadi → maxfiy havola va QR kod (dalolatnomada ham, Word'da ham).
//   2) Qabul qiluvchi xodim telefonida QR'ni skaner qiladi → dalolatnomani ko'radi, JShShIRining oxirgi 4 raqamini
//      yozadi va barmog'i bilan imzo chizadi.
//   3) Imzolangach: imzoli nusxa (Word: imzo rasmi, QR, «elektron tasdiqlangan» belgisi) bazada saqlanadi va
//      Telegram'ga 2 nusxa yuboriladi — xodimning o'ziga (bot bilan bog'langan bo'lsa) va dalolatnomalar arxiviga.
//   Imzolanguncha mulk xodimda «imzo kutilmoqda» bo'lib ko'rinadi.
// Kim imzolaydi: berish va ko'chirishda — qabul qiluvchi; qaytarishda — topshiruvchi xodim.
// ═══════════════════════════════════════════════════════════

const SIGNABLE = new Set(['ISSUE', 'TRANSFER', 'RETURN']);
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
/** Imzo rasmi (PNG data URL) chegarasi */
const MAX_SIGNATURE = 400_000;

export interface SignStatus {
  docId: string;
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  url: string;
  qr: string;
  signerPinfl: string;
  signerName: string;
  createdAt: string;
  signedAt: string | null;
  signature: string | null;
  signedIp: string | null;
  hasArchive: boolean;
  archiveName: string | null;
  telegram: { employee?: string; archive?: string; at?: string } | null;
  /** Telefon ochishi mumkin bo'lmagan manzil (localhost) — ogohlantirish */
  localOnly: boolean;
}

export interface PublicAct {
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  number: string;
  kindLabel: string;
  date: string;
  signerName: string;
  signedAt: string | null;
  locked: boolean;
  act: ActModel;
}

function isLocal(host: string): boolean {
  return /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(host);
}

/** Kompyuterning ichki tarmoq manzili (telefon shu manzil bilan ochadi) */
export function lanAddress(): string | null {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  return all.find((a) => a.startsWith('192.168.')) ?? all.find((a) => a.startsWith('10.')) ?? all.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ?? all[0] ?? null;
}

/** Brauzer manzili (origin) → telefon ochadigan manzil */
export function publicBase(origin: string | null | undefined): string {
  const env = process.env.SIGN_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/+$/, '');
  let url: URL | null = null;
  try {
    url = origin ? new URL(origin) : null;
  } catch {
    url = null;
  }
  const port = url?.port || (url ? '' : '3000');
  if (url && !isLocal(url.hostname)) return `${url.protocol}//${url.host}`;
  const lan = lanAddress();
  const proto = url?.protocol ?? 'http:';
  return `${proto}//${lan ?? url?.hostname ?? 'localhost'}${port ? `:${port}` : ''}`;
}

@Injectable()
export class WarehouseSigns {
  private readonly log = new Logger('Dalolatnoma imzosi');

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: WarehouseService,
    private readonly acts: WarehouseActs,
    private readonly templates: WarehouseTemplates,
    private readonly telegram: TelegramService,
  ) {
    // Word va ekrandagi dalolatnomaga QR kod va imzo shu yerdan qo'yiladi
    this.acts.signInfo = (docId) => this.info(docId);
  }

  /** Kim imzolaydi: berish / ko'chirish — qabul qiluvchi, qaytarish — topshiruvchi (Xodimlar bo'limidan) */
  static signerOf(d: DocView): { pinfl: string; name: string } | null {
    if (!SIGNABLE.has(d.kind) || d.cancelled) return null;
    const p = d.kind === 'RETURN' ? d.from : d.to;
    if (!p?.holderPinfl) return null;
    return { pinfl: p.holderPinfl, name: p.holderName ?? p.text };
  }

  private urlOf(row: { baseUrl: string; token: string }): string {
    return `${row.baseUrl}/imzo/${row.token}`;
  }

  /** Dalolatnoma uchun: QR va imzo ma'lumoti (Word va ekran) */
  async info(docId: string): Promise<ActSignInfo | null> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    if (!row || row.status === 'CANCELLED') return null;
    const url = this.urlOf(row);
    return {
      status: row.status as 'PENDING' | 'SIGNED',
      url,
      qr: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
      signerName: row.signerName,
      signerPinfl: row.signerPinfl,
      signedAt: row.signedAt?.toISOString() ?? null,
      signature: row.signature ?? null,
    };
  }

  private async dto(row: NonNullable<Awaited<ReturnType<PrismaService['stockDocSign']['findUnique']>>>): Promise<SignStatus> {
    const url = this.urlOf(row);
    let host = '';
    try {
      host = new URL(row.baseUrl).hostname;
    } catch {
      host = 'localhost';
    }
    return {
      docId: row.docId,
      status: row.status as SignStatus['status'],
      url,
      qr: await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' }),
      signerPinfl: row.signerPinfl,
      signerName: row.signerName,
      createdAt: row.createdAt.toISOString(),
      signedAt: row.signedAt?.toISOString() ?? null,
      signature: row.signature ?? null,
      signedIp: row.signedIp ?? null,
      hasArchive: !!row.archive,
      archiveName: row.archiveName ?? null,
      telegram: (row.telegram as SignStatus['telegram']) ?? null,
      localOnly: isLocal(host),
    };
  }

  async status(docId: string): Promise<SignStatus | null> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    return row ? this.dto(row) : null;
  }

  /** «Rasmiylashtirish»: QR havola yaratiladi (bor bo'lsa — o'sha qaytadi) */
  async start(docId: string, origin: string | null | undefined, userId: string): Promise<SignStatus> {
    const d = await this.warehouse.doc(docId);
    if (d.cancelled) throw new BadRequestException('Hujjat bekor qilingan');
    if (!SIGNABLE.has(d.kind)) throw new BadRequestException("Elektron tasdiq faqat berish, ko'chirish va qaytarish dalolatnomalari uchun");
    const signer = WarehouseSigns.signerOf(d);
    if (!signer) throw new BadRequestException("Hujjatda xodim Xodimlar bo'limidan tanlanmagan — imzolash uchun xodim (JShShIR bilan) kerak");
    const baseUrl = publicBase(origin);
    const existing = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    if (existing && existing.status === 'SIGNED') return this.dto(existing);
    if (existing) {
      const row = await this.prisma.stockDocSign.update({
        where: { docId },
        data: { status: 'PENDING', baseUrl, signerPinfl: signer.pinfl, signerName: signer.name, ...(existing.status === 'CANCELLED' ? { token: randomBytes(18).toString('base64url'), attempts: 0, lockedUntil: null } : {}) },
      });
      return this.dto(row);
    }
    const row = await this.prisma.stockDocSign.create({
      data: { docId, token: randomBytes(18).toString('base64url'), status: 'PENDING', signerPinfl: signer.pinfl, signerName: signer.name, baseUrl, createdById: userId },
    });
    return this.dto(row);
  }

  async cancel(docId: string): Promise<SignStatus | null> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    if (!row) return null;
    if (row.status === 'SIGNED') throw new BadRequestException('Imzolangan dalolatnomani bekor qilib bo‘lmaydi');
    return this.dto(await this.prisma.stockDocSign.update({ where: { docId }, data: { status: 'CANCELLED' } }));
  }

  // ─────────── Telefon (ochiq sahifa) ───────────

  private async byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new NotFoundException('Havola noto‘g‘ri');
    const row = await this.prisma.stockDocSign.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('Havola noto‘g‘ri yoki eskirgan');
    return row;
  }

  async publicView(token: string): Promise<PublicAct> {
    const row = await this.byToken(token);
    const d = await this.warehouse.doc(row.docId);
    const tpl = await this.templates.forActs();
    const act = this.acts.model(d, tpl, await this.info(row.docId));
    return {
      status: (d.cancelled ? 'CANCELLED' : row.status) as PublicAct['status'],
      number: d.number,
      kindLabel: d.kindLabel,
      date: d.date,
      signerName: personName({ ...tpl, shortNames: false }, row.signerName),
      signedAt: row.signedAt?.toISOString() ?? null,
      locked: !!row.lockedUntil && row.lockedUntil > new Date(),
      act,
    };
  }

  async sign(token: string, body: { pinfl4?: unknown; signature?: unknown; agree?: unknown }, meta: { ip?: string; agent?: string }): Promise<{ ok: true; signedAt: string }> {
    const row = await this.byToken(token);
    if (row.status === 'SIGNED') throw new BadRequestException('Bu dalolatnoma allaqachon imzolangan');
    if (row.status !== 'PENDING') throw new BadRequestException('Bu havola bekor qilingan — omborchidan yangisini so‘rang');
    const d = await this.warehouse.doc(row.docId);
    if (d.cancelled) throw new BadRequestException('Hujjat bekor qilingan');
    if (row.lockedUntil && row.lockedUntil > new Date()) throw new ForbiddenException(`Ko'p marta noto'g'ri kiritildi — ${LOCK_MINUTES} daqiqadan keyin urinib ko'ring`);
    if (body.agree !== true) throw new BadRequestException('Dalolatnoma bilan tanishganingizni belgilang');
    const p4 = typeof body.pinfl4 === 'string' ? body.pinfl4.replace(/\D/g, '') : '';
    if (p4.length !== 4) throw new BadRequestException('JShShIRning oxirgi 4 raqamini kiriting');
    if (p4 !== row.signerPinfl.slice(-4)) {
      const attempts = row.attempts + 1;
      await this.prisma.stockDocSign.update({
        where: { id: row.id },
        data: attempts >= MAX_ATTEMPTS ? { attempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { attempts },
      });
      throw new BadRequestException(attempts >= MAX_ATTEMPTS ? `Noto'g'ri. ${LOCK_MINUTES} daqiqaga yopildi` : `JShShIR mos kelmadi (${MAX_ATTEMPTS - attempts} ta urinish qoldi)`);
    }
    const sig = typeof body.signature === 'string' ? body.signature : '';
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > MAX_SIGNATURE) throw new BadRequestException('Imzo chizilmagan');
    if (sig.length < 1500) throw new BadRequestException('Imzo juda qisqa — to‘liq imzo chizing');

    const signedAt = new Date();
    await this.prisma.stockDocSign.update({
      where: { id: row.id },
      data: { status: 'SIGNED', method: 'DRAWN', signature: sig, signedAt, signedIp: meta.ip?.slice(0, 64) ?? null, signedAgent: meta.agent?.slice(0, 300) ?? null, attempts: 0, lockedUntil: null },
    });
    // Imzoli nusxa (Word) — saqlanadi
    const file = await this.acts.build(row.docId);
    const archiveName = file.filename.replace(/\.docx$/, ' (imzolangan).docx');
    await this.prisma.stockDocSign.update({ where: { id: row.id }, data: { archive: new Uint8Array(file.buffer), archiveName } });
    // Telegram: 2 nusxa (xodimga va arxivga) — xato bo'lsa ham imzo saqlanadi
    await this.deliver(row.id, d, row.signerPinfl, row.signerName, file.buffer, archiveName, signedAt).catch((e) => this.log.warn((e as Error).message));
    return { ok: true, signedAt: signedAt.toISOString() };
  }

  /** Telegram: 1-nusxa — xodimning o'ziga, 2-nusxa — dalolatnomalar arxivi guruhiga */
  async deliver(signId: string, d: DocView, pinfl: string, name: string, buffer: Buffer, filename: string, signedAt: Date): Promise<SignStatus['telegram']> {
    const result: NonNullable<SignStatus['telegram']> = { at: new Date().toISOString() };
    const when = new Date(signedAt.getTime() + 5 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);
    const caption = `📄 <b>${esc(d.kindLabel)} № ${esc(d.number)}</b>\n✍️ Imzoladi: ${esc(name)}\n🕒 ${when}\nNusxa — elektron tasdiqlangan dalolatnoma.`;
    if (!this.telegram.configured) {
      result.employee = 'bot ulanmagan';
      result.archive = 'bot ulanmagan';
    } else {
      const chat = await this.telegram.chatOf(pinfl);
      if (!chat) result.employee = 'xodim Telegram botga ulanmagan';
      else
        result.employee = await this.telegram
          .sendDocument(chat, buffer, filename, caption)
          .then(() => 'yuborildi')
          .catch((e: Error) => `xato: ${e.message}`);
      const archive = await this.telegram.archive();
      if (!archive) result.archive = 'arxiv guruhi belgilanmagan';
      else
        result.archive = await this.telegram
          .sendDocument(archive.chatId, buffer, filename, caption)
          .then(() => 'yuborildi')
          .catch((e: Error) => `xato: ${e.message}`);
    }
    await this.prisma.stockDocSign.update({ where: { id: signId }, data: { telegram: result } });
    return result;
  }

  /** Qayta yuborish (masalan, bot keyin ulandi) */
  async resend(docId: string): Promise<SignStatus> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    if (!row || row.status !== 'SIGNED' || !row.archive) throw new BadRequestException('Imzolangan nusxa yo‘q');
    const d = await this.warehouse.doc(docId);
    await this.deliver(row.id, d, row.signerPinfl, row.signerName, Buffer.from(row.archive), row.archiveName ?? `${d.number}.docx`, row.signedAt ?? new Date());
    return this.dto((await this.prisma.stockDocSign.findUnique({ where: { docId } }))!);
  }

  async archiveFile(docId: string): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    if (!row?.archive) throw new NotFoundException('Imzolangan nusxa yo‘q');
    return { buffer: Buffer.from(row.archive), filename: row.archiveName ?? 'dalolatnoma (imzolangan).docx' };
  }

  /** Arxiv: imzolangan va kutilayotgan dalolatnomalar */
  async list(status?: string): Promise<{ docId: string; number: string; kind: string; kindLabel: string; date: string; signerName: string; status: string; createdAt: string; signedAt: string | null; telegram: SignStatus['telegram'] }[]> {
    const where = status === 'PENDING' || status === 'SIGNED' ? { status } : { status: { in: ['PENDING', 'SIGNED'] } };
    const rows = await this.prisma.stockDocSign.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500, select: { docId: true, status: true, signerName: true, createdAt: true, signedAt: true, telegram: true } });
    const docs = rows.length ? await this.prisma.stockDoc.findMany({ where: { id: { in: rows.map((r) => r.docId) } }, select: { id: true, number: true, kind: true, date: true, deletedAt: true } }) : [];
    const by = new Map(docs.map((d) => [d.id, d]));
    const LABEL: Record<string, string> = { ISSUE: 'Chiqim (berish)', TRANSFER: "Ko'chirish", RETURN: 'Qaytarish' };
    return rows
      .filter((r) => by.has(r.docId) && !by.get(r.docId)!.deletedAt)
      .map((r) => {
        const d = by.get(r.docId)!;
        return {
          docId: r.docId,
          number: d.number,
          kind: d.kind,
          kindLabel: LABEL[d.kind] ?? d.kind,
          date: new Date(d.date.getTime() + 5 * 3600_000).toISOString().slice(0, 10),
          signerName: r.signerName,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          signedAt: r.signedAt?.toISOString() ?? null,
          telegram: (r.telegram as SignStatus['telegram']) ?? null,
        };
      });
  }

  /** Xodimda imzo kutayotgan hujjatlar va ulardagi vositalar */
  async pendingFor(pinfl: string | null | undefined): Promise<{ docId: string; number: string; date: string; assetIds: string[] }[]> {
    if (!pinfl) return [];
    const rows = await this.prisma.stockDocSign.findMany({ where: { signerPinfl: pinfl, status: 'PENDING' }, select: { docId: true } });
    const out: { docId: string; number: string; date: string; assetIds: string[] }[] = [];
    for (const r of rows) {
      const d = await this.warehouse.doc(r.docId).catch(() => null);
      if (!d || d.cancelled) continue;
      out.push({ docId: d.id, number: d.number, date: d.date, assetIds: d.assets.map((a) => a.id) });
    }
    return out;
  }
}