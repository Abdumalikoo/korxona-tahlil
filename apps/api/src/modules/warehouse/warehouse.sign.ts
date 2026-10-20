import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { esc, TelegramService } from '../telegram/telegram.service';
import { WarehouseActs } from './warehouse.acts';
import { WarehouseService } from './warehouse.service';
import { personName, pinflOf, sanitizeTemplate, WarehouseTemplates, type ActTemplate } from './warehouse.template';
import type { ActModel, ActSignInfo, DocInput, DocView } from './warehouse.types';

// ═══════════════════════════════════════════════════════════
// Dalolatnomani elektron tasdiqlash — SAQLASHDAN OLDIN:
//   1) Omborchi hujjatni to'ldirib «Tasdiqlash» bosadi → hujjat hali saqlanmaydi: dalolatnoma tayyorlanadi
//      (oldindan ko'rish) va maxfiy havola + QR kod chiqadi.
//   2) Qabul qiluvchi xodim telefonida QR'ni skaner qiladi → dalolatnomani ko'radi, JShShIRining oxirgi 4 raqamini
//      yozadi va barmog'i bilan imzo chizadi yoki yuz suratini oladi.
//   3) Imzolangach omborchida «Saqlash» ochiladi → hujjat bazaga yoziladi (qoldiq, asosiy vositalar joyi),
//      imzoli nusxa (Word: imzo, QR, «elektron tasdiqlangan» belgisi) saqlanadi va Telegram'ga 2 nusxa ketadi —
//      xodimning o'ziga va dalolatnomalar arxivi guruhiga.
//   Avval saqlangan (imzosiz) hujjatlarni ham keyin shu usulda imzolatish mumkin (hujjat oynasida).
// Kim imzolaydi: berish va ko'chirishda — qabul qiluvchi; qaytarishda — topshiruvchi xodim.
// ═══════════════════════════════════════════════════════════

const SIGNABLE = new Set(['ISSUE', 'TRANSFER', 'RETURN']);
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
/** Imzo rasmi (PNG) va yuz surati (JPEG) chegarasi — data URL uzunligi */
const MAX_SIGNATURE = 400_000;
const MAX_PHOTO = 700_000;
/** Saqlanmagan (imzo kutayotgan) qoralama havolasi amal qilish muddati */
const DRAFT_HOURS = 24;

type Row = NonNullable<Awaited<ReturnType<PrismaService['stockDocSign']['findUnique']>>>;

export interface SignStatus {
  docId: string | null;
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  url: string;
  qr: string;
  signerPinfl: string;
  signerName: string;
  createdAt: string;
  signedAt: string | null;
  method: string | null;
  signature: string | null;
  photo: string | null;
  signedIp: string | null;
  hasArchive: boolean;
  archiveName: string | null;
  telegram: { employee?: string; archive?: string; at?: string } | null;
  /** Telefon ochishi mumkin bo'lmagan manzil (localhost) — ogohlantirish */
  localOnly: boolean;
}

/** Saqlashdan oldingi imzo (qoralama) holati */
export interface SignDraft extends SignStatus {
  id: string;
  /** Hujjat saqlandimi (imzodan keyin «Saqlash» bosilgan) */
  saved: boolean;
  /** Muddati tugadimi (imzo kutilayotgan bo'lsa) */
  expired: boolean;
  /** Xodimga ko'rsatilgan dalolatnoma */
  act: ActModel;
}

/** Imzolovchi xodim yo'q (bo'limga berilmoqda va h.k.) — oddiy saqlash */
export interface NoSignNeeded {
  needsSign: false;
  reason: string;
}

export interface SignListItem {
  /** Tasdiq raqami (imzoli nusxani yuklash uchun) */
  id: string;
  /** Hujjat (shablon tasdig'ida — null) */
  docId: string | null;
  number: string;
  kind: string;
  kindLabel: string;
  date: string;
  signerName: string;
  status: string;
  method: string | null;
  createdAt: string;
  signedAt: string | null;
  telegram: SignStatus['telegram'];
}

export interface PublicAct {
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  number: string;
  kindLabel: string;
  date: string;
  signerName: string;
  signedAt: string | null;
  method: string | null;
  locked: boolean;
  /** Hujjat hali saqlanmagan (imzodan keyin omborchi saqlaydi) */
  draft: boolean;
  /** DOC — hujjat (xodim qabul qiladi), TEMPLATE — dalolatnoma shablonini rahbar tasdiqlaydi */
  subject: 'DOC' | 'TEMPLATE';
  act: ActModel;
}

interface DraftData {
  input: DocInput;
  view: DocView;
}

/** Shablonni tasdiqlash: saqlanadigan shablon va saqlangan vaqt */
interface TemplateDraft {
  template: ActTemplate;
  savedAt?: string;
}

const TEMPLATE = 'TEMPLATE';

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

/** Imzolangan mazmun o'zgarmaganini tekshirish uchun: kim, qayerdan-qayerga, nima, qancha */
export function fingerprint(d: DocView): string {
  return JSON.stringify({
    kind: d.kind,
    to: [d.to.holderPinfl, d.to.holderName, d.to.text],
    from: d.from ? [d.from.holderPinfl, d.from.holderName, d.from.text] : null,
    lines: d.lines.map((l) => [l.itemId, l.qty]).sort(),
    assets: d.assets.map((a) => a.id).sort(),
  });
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

  private qr(url: string, width = 240): Promise<string> {
    return QRCode.toDataURL(url, { margin: 1, width, errorCorrectionLevel: 'M' });
  }

  private templateOf(row: Row): TemplateDraft | null {
    if (row.kind !== TEMPLATE) return null;
    const v = row.draft as unknown as TemplateDraft | null;
    return v && typeof v === 'object' && v.template ? v : null;
  }

  private draftOf(row: Row): DraftData | null {
    const v = row.draft as unknown as DraftData | null;
    return v && typeof v === 'object' && v.view && v.input ? v : null;
  }

  private expired(row: Row): boolean {
    return !row.docId && row.status === 'PENDING' && row.createdAt.getTime() < Date.now() - DRAFT_HOURS * 3600_000;
  }

  private async infoOf(row: Row): Promise<ActSignInfo | null> {
    if (row.status === 'CANCELLED') return null;
    const url = this.urlOf(row);
    return {
      status: row.status === 'SIGNED' ? 'SIGNED' : 'PENDING',
      url,
      qr: await this.qr(url),
      signerName: row.signerName,
      signerPinfl: row.signerPinfl,
      signedAt: row.signedAt?.toISOString() ?? null,
      signature: row.signature ?? null,
      photo: row.photo ?? null,
      method: row.method ?? null,
      subject: row.kind === TEMPLATE ? 'TEMPLATE' : 'DOC',
    };
  }

  /** Dalolatnoma uchun: QR va imzo ma'lumoti (Word va ekran) */
  async info(docId: string): Promise<ActSignInfo | null> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    return row ? this.infoOf(row) : null;
  }

  private async dto(row: Row): Promise<SignStatus> {
    const url = this.urlOf(row);
    let host = '';
    try {
      host = new URL(row.baseUrl).hostname;
    } catch {
      host = 'localhost';
    }
    return {
      docId: row.docId,
      status: (row.status === 'SAVING' ? 'SIGNED' : row.status) as SignStatus['status'],
      url,
      qr: await this.qr(url, 320),
      signerPinfl: row.signerPinfl,
      signerName: row.signerName,
      createdAt: row.createdAt.toISOString(),
      signedAt: row.signedAt?.toISOString() ?? null,
      method: row.method ?? null,
      signature: row.signature ?? null,
      photo: row.photo ?? null,
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

  // ═════════════ Saqlashdan oldin: «Tasdiqlash» → QR → imzo → «Saqlash» ═════════════

  private async draftDto(row: Row): Promise<SignDraft> {
    const tdata = this.templateOf(row);
    if (tdata) {
      const act = await this.acts.sampleModel('ISSUE', tdata.template, await this.infoOf(row));
      return { ...(await this.dto(row)), id: row.id, saved: !!tdata.savedAt, expired: this.expired(row), act };
    }
    const data = this.draftOf(row);
    const tpl = await this.templates.forActs();
    let act: ActModel;
    if (row.docId) act = await this.acts.view(row.docId);
    else if (data) act = this.acts.model(data.view, tpl, await this.infoOf(row));
    else throw new NotFoundException('Qoralama topilmadi');
    return { ...(await this.dto(row)), id: row.id, saved: !!row.docId, expired: this.expired(row), act };
  }

  /**
   * «Tasdiqlash»: hujjat tekshiriladi va dalolatnoma tayyorlanadi (bazaga yozilmaydi),
   * qabul qiluvchi uchun QR havola beriladi. Imzolovchi xodim bo'lmasa — needsSign: false (oddiy saqlash).
   */
  async createDraft(input: DocInput, origin: string | null | undefined, userId: string): Promise<SignDraft | NoSignNeeded> {
    const body = input ?? {};
    if (!SIGNABLE.has(String(body.kind))) return { needsSign: false, reason: 'Bu hujjat turi imzolanmaydi' };
    const view = await this.warehouse.createDoc(body, userId, { preview: true });
    const signer = WarehouseSigns.signerOf(view);
    if (!signer) {
      return {
        needsSign: false,
        reason: view.kind === 'RETURN' ? "Topshiruvchi xodim aniqlanmadi (vositalar turli joylardan yoki bo'limdan) — dalolatnoma qog'ozda imzolanadi" : "Oluvchi xodim tanlanmagan (bo'lim yoki hududga) — dalolatnoma qog'ozda imzolanadi",
      };
    }
    // Shu omborchining avvalgi saqlanmagan qoralamalari — bekor (bitta oynada bitta QR)
    await this.prisma.stockDocSign.updateMany({ where: { docId: null, createdById: userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    const row = await this.prisma.stockDocSign.create({
      data: {
        docId: null,
        token: randomBytes(18).toString('base64url'),
        status: 'PENDING',
        kind: view.kind,
        draft: { input: body, view } as unknown as Prisma.InputJsonValue,
        signerPinfl: signer.pinfl,
        signerName: signer.name,
        baseUrl: publicBase(origin),
        createdById: userId,
      },
    });
    return this.draftDto(row);
  }

  // ═════════════ Dalolatnoma shablonini rahbar tasdiqlashi ═════════════

  /**
   * Shablon «Tasdiqlash»: shablon hali saqlanmaydi — namunasi tayyorlanadi va tasdiqlovchi rahbar uchun QR beriladi.
   * Tasdiqlovchi — tanlangan xodim yoki shablondagi rahbar (Xodimlar bo'limidan).
   */
  async createTemplateDraft(template: unknown, signerPinfl: string | null | undefined, origin: string | null | undefined, userId: string): Promise<SignDraft> {
    if (!template || typeof template !== 'object') throw new BadRequestException("Shablon noto'g'ri");
    const clean = sanitizeTemplate(template);
    const pin = pinflOf(signerPinfl) ?? clean.approverPinfl;
    if (!pin) throw new BadRequestException("Tasdiqlovchini tanlang — shablonda rahbar Xodimlar bo'limidan tanlanmagan");
    const emp = await this.prisma.employee.findUnique({ where: { pinfl: pin }, select: { fullName: true } });
    if (!emp) throw new BadRequestException("Tasdiqlovchi xodim Xodimlar bo'limida topilmadi");
    await this.prisma.stockDocSign.updateMany({ where: { docId: null, kind: TEMPLATE, createdById: userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    const row = await this.prisma.stockDocSign.create({
      data: {
        docId: null,
        kind: TEMPLATE,
        token: randomBytes(18).toString('base64url'),
        status: 'PENDING',
        draft: { template: clean } as unknown as Prisma.InputJsonValue,
        signerPinfl: pin,
        signerName: emp.fullName,
        baseUrl: publicBase(origin),
        createdById: userId,
      },
    });
    return this.draftDto(row);
  }

  /** Imzolangan shablonni saqlash: shablon bazaga, tasdiqlangan namuna (Word) arxivga va Telegram'ga */
  private async commitTemplate(row: Row, data: TemplateDraft, userId: string): Promise<{ doc: null; template: ActTemplate; sign: SignStatus }> {
    if (data.savedAt) return { doc: null, template: await this.templates.get(), sign: await this.dto(row) };
    const lock = await this.prisma.stockDocSign.updateMany({ where: { id: row.id, status: 'SIGNED' }, data: { status: 'SAVING' } });
    if (lock.count !== 1) throw new ConflictException('Saqlanmoqda — biroz kuting');
    let template: ActTemplate;
    try {
      template = await this.templates.save(data.template, userId);
    } catch (e) {
      await this.prisma.stockDocSign.updateMany({ where: { id: row.id, status: 'SAVING' }, data: { status: 'SIGNED' } });
      throw e;
    }
    const savedAt = new Date();
    const signed = { ...row, status: 'SIGNED' };
    const file = await this.acts.buildSample('ISSUE', null, template, await this.infoOf(signed));
    const day = new Date(savedAt.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
    const archiveName = `Dalolatnoma shabloni - tasdiqlangan ${day}.docx`;
    await this.prisma.stockDocSign.update({
      where: { id: row.id },
      data: { status: 'SIGNED', draft: { template, savedAt: savedAt.toISOString() } as unknown as Prisma.InputJsonValue, archive: new Uint8Array(file.buffer), archiveName },
    });
    await this.deliver(row.id, 'Dalolatnoma shabloni', row.signerPinfl, row.signerName, file.buffer, archiveName, row.signedAt ?? savedAt, row.method, 'Shablon tasdiqlandi — yangi dalolatnomalar shu bo‘yicha chiqadi.').catch((e) =>
      this.log.warn((e as Error).message),
    );
    return { doc: null, template, sign: await this.dto((await this.prisma.stockDocSign.findUnique({ where: { id: row.id } }))!) };
  }

  /** Shablonning oxirgi tasdig'i (shablon sahifasida ko'rsatiladi) */
  async lastTemplateApproval(): Promise<{ id: string; signerName: string; signedAt: string | null; method: string | null; savedAt: string } | null> {
    const rows = await this.prisma.stockDocSign.findMany({ where: { kind: TEMPLATE, status: 'SIGNED' }, orderBy: { updatedAt: 'desc' }, take: 20 });
    for (const r of rows) {
      const t = this.templateOf(r);
      if (t?.savedAt) return { id: r.id, signerName: r.signerName, signedAt: r.signedAt?.toISOString() ?? null, method: r.method ?? null, savedAt: t.savedAt };
    }
    return null;
  }

  /** Imzoli nusxa (Word) — tasdiq raqami bo'yicha (shablon tasdig'i uchun ham) */
  async archiveById(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { id } });
    if (!row?.archive) throw new NotFoundException('Imzolangan nusxa yo‘q');
    return { buffer: Buffer.from(row.archive), filename: row.archiveName ?? 'dalolatnoma (imzolangan).docx' };
  }

  private async draftRow(id: string): Promise<Row> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { id } });
    if (!row || (!row.draft && !row.docId)) throw new NotFoundException('Tasdiqlash topilmadi');
    return row;
  }

  async draftStatus(id: string): Promise<SignDraft> {
    return this.draftDto(await this.draftRow(id));
  }

  async cancelDraft(id: string): Promise<SignDraft> {
    const row = await this.draftRow(id);
    if (row.docId || this.templateOf(row)?.savedAt) throw new BadRequestException('Allaqachon saqlangan');
    return this.draftDto(await this.prisma.stockDocSign.update({ where: { id }, data: { status: 'CANCELLED' } }));
  }

  /**
   * «Saqlash» (faqat imzolangandan keyin): hujjat bazaga yoziladi, imzoli nusxa saqlanadi va Telegram'ga yuboriladi.
   * Imzolangandan keyin ombordagi holat o'zgarib, dalolatnoma mazmuni boshqacha chiqsa — saqlanmaydi (qayta imzolatiladi).
   */
  async commitDraft(id: string, userId: string): Promise<{ doc: DocView | null; template?: ActTemplate; sign: SignStatus }> {
    const row = await this.draftRow(id);
    if (row.docId) return { doc: await this.warehouse.doc(row.docId), sign: await this.dto(row) };
    const tdata = this.templateOf(row);
    if (tdata?.savedAt) return this.commitTemplate(row, tdata, userId);
    if (row.status === 'PENDING') throw new BadRequestException(tdata ? 'Rahbar hali tasdiqlamagan — QR kod orqali tasdiqlangach saqlanadi' : 'Xodim hali imzolamagan — QR kod orqali imzolangach saqlanadi');
    if (row.status !== 'SIGNED') throw new BadRequestException(row.status === 'SAVING' ? 'Saqlanmoqda — biroz kuting' : 'Tasdiqlash bekor qilingan — qaytadan «Tasdiqlash» bosing');
    if (tdata) return this.commitTemplate(row, tdata, userId);
    const data = this.draftOf(row);
    if (!data) throw new NotFoundException('Qoralama topilmadi');

    // Ikki marta bosilsa ham bitta hujjat: SIGNED → SAVING (faqat bittasi o'tadi)
    const lock = await this.prisma.stockDocSign.updateMany({ where: { id, status: 'SIGNED', docId: null }, data: { status: 'SAVING' } });
    if (lock.count !== 1) throw new ConflictException('Saqlanmoqda — biroz kuting');
    let doc: DocView;
    try {
      const again = await this.warehouse.createDoc(data.input, userId, { preview: true });
      if (fingerprint(again) !== fingerprint(data.view)) {
        await this.prisma.stockDocSign.update({ where: { id }, data: { status: 'CANCELLED' } });
        throw new BadRequestException("Imzolangandan keyin ombordagi holat o'zgardi (vositalar yoki oluvchi) — hujjatni qayta tekshirib, yana «Tasdiqlash» bosing");
      }
      doc = await this.warehouse.createDoc(data.input, userId);
    } catch (e) {
      // Saqlab bo'lmadi (masalan, qoldiq yetmay qoldi) — imzo saqlanib qoladi, qayta urinish mumkin
      await this.prisma.stockDocSign.updateMany({ where: { id, status: 'SAVING' }, data: { status: 'SIGNED' } });
      throw e;
    }
    await this.prisma.stockDocSign.update({ where: { id }, data: { docId: doc.id, status: 'SIGNED' } });
    const sign = await this.finalize(id, doc);
    return { doc, sign };
  }

  /** Imzoli nusxa (Word) — bazada; Telegram'ga 2 nusxa */
  private async finalize(id: string, d: DocView): Promise<SignStatus> {
    const row = (await this.prisma.stockDocSign.findUnique({ where: { id } }))!;
    const file = await this.acts.build(d.id);
    const archiveName = file.filename.replace(/\.docx$/, ' (imzolangan).docx');
    await this.prisma.stockDocSign.update({ where: { id }, data: { archive: new Uint8Array(file.buffer), archiveName } });
    await this.deliver(id, `${d.kindLabel} № ${d.number}`, row.signerPinfl, row.signerName, file.buffer, archiveName, row.signedAt ?? new Date(), row.method).catch((e) => this.log.warn((e as Error).message));
    return this.dto((await this.prisma.stockDocSign.findUnique({ where: { id } }))!);
  }

  // ═════════════ Saqlangan hujjatni keyin imzolatish (hujjat oynasidan) ═════════════

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
      data: { docId, kind: d.kind, token: randomBytes(18).toString('base64url'), status: 'PENDING', signerPinfl: signer.pinfl, signerName: signer.name, baseUrl, createdById: userId },
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

  private async byToken(token: string): Promise<Row> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new NotFoundException('Havola noto‘g‘ri');
    const row = await this.prisma.stockDocSign.findUnique({ where: { token } });
    if (!row) throw new NotFoundException('Havola noto‘g‘ri yoki eskirgan');
    return row;
  }

  async publicView(token: string): Promise<PublicAct> {
    const row = await this.byToken(token);
    const tpl = await this.templates.forActs();
    const signerName = personName({ ...tpl, shortNames: false }, row.signerName);
    const base = { signerName, signedAt: row.signedAt?.toISOString() ?? null, method: row.method ?? null, locked: !!row.lockedUntil && row.lockedUntil > new Date() };
    const tdata = this.templateOf(row);
    if (tdata) {
      const status = this.expired(row) || row.status === 'CANCELLED' ? 'CANCELLED' : row.status === 'PENDING' ? 'PENDING' : 'SIGNED';
      const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
      return { ...base, status, number: 'shablon', kindLabel: 'Dalolatnoma shabloni', date: today, draft: !tdata.savedAt, subject: 'TEMPLATE', act: await this.acts.sampleModel('ISSUE', tdata.template, await this.infoOf(row)) };
    }
    if (row.docId) {
      const d = await this.warehouse.doc(row.docId);
      return { ...base, subject: 'DOC', status: (d.cancelled ? 'CANCELLED' : row.status === 'SAVING' ? 'SIGNED' : row.status) as PublicAct['status'], number: d.number, kindLabel: d.kindLabel, date: d.date, draft: false, act: this.acts.model(d, tpl, await this.infoOf(row)) };
    }
    const data = this.draftOf(row);
    if (!data) throw new NotFoundException('Havola noto‘g‘ri yoki eskirgan');
    const status = this.expired(row) || row.status === 'CANCELLED' ? 'CANCELLED' : row.status === 'PENDING' ? 'PENDING' : 'SIGNED';
    return { ...base, status, number: data.view.number, kindLabel: data.view.kindLabel, date: data.view.date, draft: true, subject: 'DOC', act: this.acts.model(data.view, tpl, await this.infoOf(row)) };
  }

  async sign(
    token: string,
    body: { pinfl4?: unknown; signature?: unknown; photo?: unknown; method?: unknown; agree?: unknown },
    meta: { ip?: string; agent?: string },
  ): Promise<{ ok: true; signedAt: string; draft: boolean }> {
    const row = await this.byToken(token);
    if (row.status === 'SIGNED' || row.status === 'SAVING') throw new BadRequestException('Bu dalolatnoma allaqachon imzolangan');
    if (row.status !== 'PENDING' || this.expired(row)) throw new BadRequestException('Bu havola bekor qilingan yoki eskirgan — omborchidan yangisini so‘rang');
    const d = row.docId ? await this.warehouse.doc(row.docId) : null;
    if (d?.cancelled) throw new BadRequestException('Hujjat bekor qilingan');
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
    const method = body.method === 'PHOTO' ? 'PHOTO' : 'DRAWN';
    let signature: string | null = null;
    let photo: string | null = null;
    if (method === 'DRAWN') {
      const sig = typeof body.signature === 'string' ? body.signature : '';
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > MAX_SIGNATURE) throw new BadRequestException('Imzo chizilmagan');
      if (sig.length < 1500) throw new BadRequestException('Imzo juda qisqa — to‘liq imzo chizing');
      signature = sig;
    } else {
      const ph = typeof body.photo === 'string' ? body.photo : '';
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(ph) || ph.length > MAX_PHOTO) throw new BadRequestException('Yuz surati olinmagan');
      if (ph.length < 5000) throw new BadRequestException('Surat juda kichik — qaytadan oling');
      photo = ph;
    }

    const signedAt = new Date();
    await this.prisma.stockDocSign.update({
      where: { id: row.id },
      data: { status: 'SIGNED', method, signature, photo, signedAt, signedIp: meta.ip?.slice(0, 64) ?? null, signedAgent: meta.agent?.slice(0, 300) ?? null, attempts: 0, lockedUntil: null },
    });
    // Saqlangan hujjat — imzoli nusxa va Telegram darhol; saqlanmagan — omborchi «Saqlash» bosganda
    if (d) await this.finalize(row.id, d).catch((e) => this.log.warn((e as Error).message));
    return { ok: true, signedAt: signedAt.toISOString(), draft: !d };
  }

  /** Telegram: 1-nusxa — xodimning o'ziga, 2-nusxa — dalolatnomalar arxivi guruhiga */
  async deliver(signId: string, title: string, pinfl: string, name: string, buffer: Buffer, filename: string, signedAt: Date, method?: string | null, note = 'Nusxa — elektron tasdiqlangan dalolatnoma.'): Promise<SignStatus['telegram']> {
    const result: NonNullable<SignStatus['telegram']> = { at: new Date().toISOString() };
    const when = new Date(signedAt.getTime() + 5 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);
    const how = method === 'PHOTO' ? 'yuz surati bilan' : 'imzo chizib';
    const caption = `📄 <b>${esc(title)}</b>\n✍️ Tasdiqladi: ${esc(name)} (${how})\n🕒 ${when}\n${esc(note)}`;
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
    await this.deliver(row.id, `${d.kindLabel} № ${d.number}`, row.signerPinfl, row.signerName, Buffer.from(row.archive), row.archiveName ?? `${d.number}.docx`, row.signedAt ?? new Date(), row.method);
    return this.dto((await this.prisma.stockDocSign.findUnique({ where: { docId } }))!);
  }

  async archiveFile(docId: string): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.prisma.stockDocSign.findUnique({ where: { docId } });
    if (!row?.archive) throw new NotFoundException('Imzolangan nusxa yo‘q');
    return { buffer: Buffer.from(row.archive), filename: row.archiveName ?? 'dalolatnoma (imzolangan).docx' };
  }

  /** Arxiv: imzolangan va kutilayotgan (saqlangan) dalolatnomalar hamda tasdiqlangan shablonlar */
  async list(status?: string): Promise<SignListItem[]> {
    const st = status === 'PENDING' || status === 'SIGNED' ? { status } : { status: { in: ['PENDING', 'SIGNED'] } };
    const select = { id: true, docId: true, kind: true, draft: true, status: true, method: true, signerName: true, createdAt: true, signedAt: true, updatedAt: true, telegram: true } as const;
    const rows = await this.prisma.stockDocSign.findMany({ where: { docId: { not: null }, ...st }, orderBy: { createdAt: 'desc' }, take: 500, select });
    const ids = rows.map((r) => r.docId).filter((x): x is string => !!x);
    const docs = ids.length ? await this.prisma.stockDoc.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, kind: true, date: true, deletedAt: true } }) : [];
    const by = new Map(docs.map((d) => [d.id, d]));
    const LABEL: Record<string, string> = { ISSUE: 'Chiqim (berish)', TRANSFER: "Ko'chirish", RETURN: 'Qaytarish' };
    const out: SignListItem[] = rows
      .filter((r) => r.docId && by.has(r.docId) && !by.get(r.docId)!.deletedAt)
      .map((r) => {
        const d = by.get(r.docId!)!;
        return {
          id: r.id,
          docId: d.id,
          number: d.number,
          kind: d.kind,
          kindLabel: LABEL[d.kind] ?? d.kind,
          date: new Date(d.date.getTime() + 5 * 3600_000).toISOString().slice(0, 10),
          signerName: r.signerName,
          status: r.status,
          method: r.method ?? null,
          createdAt: r.createdAt.toISOString(),
          signedAt: r.signedAt?.toISOString() ?? null,
          telegram: (r.telegram as SignStatus['telegram']) ?? null,
        };
      });
    // Tasdiqlangan (saqlangan) shablonlar
    if (status !== 'PENDING') {
      const tpls = await this.prisma.stockDocSign.findMany({ where: { kind: TEMPLATE, status: 'SIGNED' }, orderBy: { updatedAt: 'desc' }, take: 100, select });
      for (const r of tpls) {
        const savedAt = (r.draft as { savedAt?: string } | null)?.savedAt;
        if (!savedAt) continue;
        out.push({
          id: r.id,
          docId: null,
          number: 'Shablon',
          kind: TEMPLATE,
          kindLabel: 'Dalolatnoma shabloni',
          date: new Date(new Date(savedAt).getTime() + 5 * 3600_000).toISOString().slice(0, 10),
          signerName: r.signerName,
          status: r.status,
          method: r.method ?? null,
          createdAt: r.createdAt.toISOString(),
          signedAt: r.signedAt?.toISOString() ?? null,
          telegram: (r.telegram as SignStatus['telegram']) ?? null,
        });
      }
      out.sort((a, b) => (b.signedAt ?? b.createdAt).localeCompare(a.signedAt ?? a.createdAt));
    }
    return out;
  }

  /** Xodimda imzo kutayotgan (saqlangan) hujjatlar va ulardagi vositalar */
  async pendingFor(pinfl: string | null | undefined): Promise<{ docId: string; number: string; date: string; assetIds: string[] }[]> {
    if (!pinfl) return [];
    const rows = await this.prisma.stockDocSign.findMany({ where: { signerPinfl: pinfl, status: 'PENDING', docId: { not: null } }, select: { docId: true } });
    const out: { docId: string; number: string; date: string; assetIds: string[] }[] = [];
    for (const r of rows) {
      if (!r.docId) continue;
      const d = await this.warehouse.doc(r.docId).catch(() => null);
      if (!d || d.cancelled) continue;
      out.push({ docId: d.id, number: d.number, date: d.date, assetIds: d.assets.map((a) => a.id) });
    }
    return out;
  }
}