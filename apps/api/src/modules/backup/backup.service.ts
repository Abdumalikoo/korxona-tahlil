import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertBackupKey, BACKUP_EXT, backupKeyRaw, prepareEncryptedFile, verifyEncrypted } from '../../common/crypto/backup-cipher';

/** Zaxiralar shuncha kun saqlanadi */
const RETENTION_DAYS = 30;

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  /** Shifrlanganmi (.sql.gz.enc) */
  encrypted: boolean;
  /** Ikkinchi joyda nusxasi bormi (null — ikkinchi joy sozlanmagan) */
  mirrored: boolean | null;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  private lastMirror: { ok: boolean; at: string } | null = null;

  /** Zaxiralar papkasi */
  private get backupDir(): string {
    return process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
  }

  /** Ikkinchi joy (boshqa disk, tarmoq papkasi) — ixtiyoriy */
  private get mirrorDir(): string | null {
    const d = (process.env.BACKUP_MIRROR_DIR ?? '').trim();
    return d ? d : null;
  }

  /** Baza ulanish malumotlari */
  private parseDatabaseUrl(): {
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
  } {
    const url = process.env.DATABASE_URL;

    if (!url) {
      throw new BadRequestException('DATABASE_URL sozlanmagan');
    }

    const match = /^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/.exec(url);

    if (!match) {
      throw new BadRequestException('DATABASE_URL notogri formatda');
    }

    return {
      user: decodeURIComponent(match[1] ?? ''),
      password: decodeURIComponent(match[2] ?? ''),
      host: match[3] ?? 'localhost',
      port: match[4] ?? '5432',
      database: match[5] ?? '',
    };
  }

  /** Fayl nomi: korxona_2026-09-18_14-30.sql */
  private buildFileName(): string {
    const now = new Date(Date.now() + 5 * 3600_000);
    const date = now.toISOString().slice(0, 10);
    const time = now.toISOString().slice(11, 16).replace(':', '-');
    return `korxona_${date}_${time}.sql`;
  }

  /** pg_dump argumentlari: -f berilmasa — natija stdout'ga */
  private dumpArgs(config: { host: string; port: string; user: string; database: string }, filePath?: string): string[] {
    return ['-h', config.host, '-p', config.port, '-U', config.user, '-d', config.database, ...(filePath ? ['-f', filePath] : []), '--no-owner', '--no-privileges'];
  }

  /**
   * Zaxira oladi.
   *  • BACKUP_ENCRYPTION_KEY bo'lsa — pg_dump → gzip → AES-256-GCM (.sql.gz.enc), ochiq SQL diskka yozilmaydi;
   *    yozilgach fayl to'liq ochib tekshiriladi.
   *  • Bo'lmasa — avvalgidek ochiq .sql (xavfsizlik holatida ogohlantirish chiqadi).
   *  • BACKUP_MIRROR_DIR bo'lsa — tayyor fayl o'sha papkaga ham nusxalanadi (boshqa disk / tarmoq papkasi).
   */
  async create(): Promise<BackupFile> {
    const config = this.parseDatabaseUrl();
    const dir = this.backupDir;
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const raw = backupKeyRaw();
    if (raw) assertBackupKey(raw);
    const base = this.buildFileName().replace(/\.sql$/, '');
    const fileName = raw ? `${base}${BACKUP_EXT}` : `${base}.sql`;
    const filePath = join(dir, fileName);
    const env = { ...process.env, PGPASSWORD: config.password };

    try {
      if (raw) {
        // Avval kalit va fayl tayyor, keyin pg_dump — natija birinchi baytidan shifrlanadi
        const target = await prepareEncryptedFile(filePath, raw);
        const child = spawn('pg_dump', this.dumpArgs(config), { env, stdio: ['ignore', 'pipe', 'pipe'] });
        await Promise.all([target.pipeFrom(child.stdout), this.waitDump(child)]);
        const plainBytes = await verifyEncrypted(filePath, raw);
        if (plainBytes < 64) throw new BadRequestException("Zaxira bo'sh chiqdi — pg_dump natijasini tekshiring");
      } else {
        const child = spawn('pg_dump', this.dumpArgs(config, filePath), { env, stdio: ['ignore', 'ignore', 'pipe'] });
        await this.waitDump(child);
      }
    } catch (error) {
      await unlink(filePath).catch(() => undefined); // chala fayl qolmasin
      throw error;
    }

    await chmod(filePath, 0o600).catch(() => undefined);
    const info = await stat(filePath);
    const mirrored = await this.mirror(filePath, fileName);
    this.logger.log(`Zaxira olindi: ${fileName} (${info.size} bayt${raw ? ', shifrlangan' : ', SHIFRLANMAGAN'}${mirrored === null ? '' : mirrored ? ', nusxa ikkinchi joyda' : ', ikkinchi joyga nusxa OLINMADI'})`);
    return { name: fileName, path: filePath, sizeBytes: info.size, createdAt: info.birthtime.toISOString(), encrypted: Boolean(raw), mirrored };
  }

  private waitDump(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let errorOutput = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });
      child.on('error', (error) => reject(new BadRequestException(`pg_dump ishga tushmadi: ${error.message}. PostgreSQL PATH da bormi?`)));
      child.on('close', (code) => {
        if (code === 0) resolve();
        // Xabarda server yo'llari va ulanish ma'lumoti ko'rsatilmaydi
        else reject(new BadRequestException(`Zaxira olishda xato (kod ${code}): ${errorOutput.replace(/(\/|[A-Za-z]:\\)[^\s"']+/g, '…').replace(/password[^\s]*/gi, '…').slice(0, 200)}`));
      });
    });
  }

  /** Ikkinchi joyga nusxa: null — sozlanmagan, true/false — natija */
  private async mirror(filePath: string, fileName: string): Promise<boolean | null> {
    const target = this.mirrorDir;
    if (!target) return null;
    try {
      if (!existsSync(target)) await mkdir(target, { recursive: true });
      await copyFile(filePath, join(target, fileName));
      await chmod(join(target, fileName), 0o600).catch(() => undefined);
      this.lastMirror = { ok: true, at: new Date().toISOString() };
      return true;
    } catch (error) {
      this.lastMirror = { ok: false, at: new Date().toISOString() };
      this.logger.error(`Zaxirani ikkinchi joyga nusxalab bo'lmadi: ${(error as Error).message}`);
      return false;
    }
  }

  /** Zaxira fayli nomi to'g'rimi (yo'l bo'laklarisiz) */
  static isBackupName(name: string): boolean {
    return /^[\w.-]+\.sql(\.gz\.enc)?$/.test(name) && !name.includes('..');
  }

  /** Yuklab olish uchun to'liq yo'l (faqat zaxiralar papkasi ichidan) */
  resolve(name: string): string | null {
    if (!BackupService.isBackupName(name)) return null;
    const p = join(this.backupDir, name);
    return existsSync(p) ? p : null;
  }

  /** Mavjud zaxiralar royxati */
  async list(): Promise<BackupFile[]> {
    return this.listIn(this.backupDir, true);
  }

  private async listIn(dir: string, withMirror: boolean): Promise<BackupFile[]> {
    if (!existsSync(dir)) return [];
    const names = await readdir(dir);
    const mirror = withMirror && this.mirrorDir && existsSync(this.mirrorDir) ? new Set(await readdir(this.mirrorDir)) : null;
    const files: BackupFile[] = [];
    for (const name of names) {
      if (!BackupService.isBackupName(name)) continue;
      const path = join(dir, name);
      const info = await stat(path);
      files.push({ name, path, sizeBytes: info.size, createdAt: info.birthtime.toISOString(), encrypted: name.endsWith(BACKUP_EXT), mirrored: mirror ? mirror.has(name) : null });
    }
    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Eski zaxiralarni ochiradi (ikkinchi joydagilarni ham) */
  async cleanup(): Promise<{ deleted: number }> {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
    let deleted = 0;
    for (const dir of [this.backupDir, this.mirrorDir].filter((d): d is string => Boolean(d))) {
      for (const file of await this.listIn(dir, false)) {
        if (new Date(file.createdAt).getTime() < cutoff) {
          await unlink(file.path).catch(() => undefined);
          if (dir === this.backupDir) deleted += 1;
        }
      }
    }
    if (deleted > 0) this.logger.log(`${deleted} ta eski zaxira ochirildi`);
    return { deleted };
  }

  /** Har kuni soat 2:00 da avtomatik zaxira */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledBackup(): Promise<void> {
    try {
      await this.create();
      await this.cleanup();
    } catch (error) {
      this.logger.error(`Avtomatik zaxira muvaffaqiyatsiz: ${String(error)}`);
    }
  }

  /** Zaxiralar haqida umumiy malumot */
  async stats(): Promise<{
    count: number;
    totalBytes: number;
    lastBackup: string | null;
    retentionDays: number;
    directory: string;
    encryption: boolean;
    lastEncrypted: boolean | null;
    mirror: { configured: boolean; directory: string | null; last: { ok: boolean; at: string } | null };
  }> {
    const files = await this.list();
    return {
      count: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      lastBackup: files[0]?.createdAt ?? null,
      retentionDays: RETENTION_DAYS,
      directory: this.backupDir,
      encryption: Boolean(backupKeyRaw()),
      lastEncrypted: files[0] ? files[0].encrypted : null,
      mirror: { configured: Boolean(this.mirrorDir), directory: this.mirrorDir, last: this.lastMirror },
    };
  }
}