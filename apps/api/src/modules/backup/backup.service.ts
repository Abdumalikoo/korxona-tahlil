import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Zaxiralar shuncha kun saqlanadi */
const RETENTION_DAYS = 30;

export interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  /** Zaxiralar papkasi */
  private get backupDir(): string {
    return process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
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

  /** Zaxira oladi */
  async create(): Promise<BackupFile> {
    const config = this.parseDatabaseUrl();
    const dir = this.backupDir;

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const fileName = this.buildFileName();
    const filePath = join(dir, fileName);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'pg_dump',
        [
          '-h',
          config.host,
          '-p',
          config.port,
          '-U',
          config.user,
          '-d',
          config.database,
          '-f',
          filePath,
          '--no-owner',
          '--no-privileges',
        ],
        {
          env: { ...process.env, PGPASSWORD: config.password },
        },
      );

      let errorOutput = '';

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });

      child.on('error', (error) => {
        reject(
          new BadRequestException(
            `pg_dump ishga tushmadi: ${error.message}. PostgreSQL PATH da bormi?`,
          ),
        );
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new BadRequestException(
              `Zaxira olishda xato (kod ${code}): ${errorOutput.slice(0, 200)}`,
            ),
          );
        }
      });
    });

    const info = await stat(filePath);

    this.logger.log(`Zaxira olindi: ${fileName} (${info.size} bayt)`);

    return {
      name: fileName,
      path: filePath,
      sizeBytes: info.size,
      createdAt: info.birthtime.toISOString(),
    };
  }

  /** Mavjud zaxiralar royxati */
  async list(): Promise<BackupFile[]> {
    const dir = this.backupDir;

    if (!existsSync(dir)) {
      return [];
    }

    const names = await readdir(dir);
    const files: BackupFile[] = [];

    for (const name of names) {
      if (!name.endsWith('.sql')) continue;

      const path = join(dir, name);
      const info = await stat(path);

      files.push({
        name,
        path,
        sizeBytes: info.size,
        createdAt: info.birthtime.toISOString(),
      });
    }

    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Eski zaxiralarni ochiradi */
  async cleanup(): Promise<{ deleted: number }> {
    const files = await this.list();
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;

    let deleted = 0;

    for (const file of files) {
      if (new Date(file.createdAt).getTime() < cutoff) {
        await unlink(file.path);
        deleted += 1;
      }
    }

    if (deleted > 0) {
      this.logger.log(`${deleted} ta eski zaxira ochirildi`);
    }

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
  }> {
    const files = await this.list();

    return {
      count: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      lastBackup: files[0]?.createdAt ?? null,
      retentionDays: RETENTION_DAYS,
      directory: this.backupDir,
    };
  }
}
