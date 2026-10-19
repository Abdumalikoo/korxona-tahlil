import {
    BadRequestException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Python tahlil xizmati (apps/analytics) bilan aloqa.
 *
 * Xizmat faqat 127.0.0.1 da ishlaydi va X-Analytics-Key kalitini talab qiladi.
 * Kalit apps/analytics/.env faylidan o'qiladi — bitta joyda saqlanadi.
 */
@Injectable()
export class ModelingService {
  private readonly logger = new Logger(ModelingService.name);
  private readonly baseUrl = process.env.ANALYTICS_URL ?? 'http://127.0.0.1:8001';
  private readonly key = process.env.ANALYTICS_KEY ?? this.readKeyFromEnvFile();

  /** apps/analytics/.env dan ANALYTICS_KEY ni o'qiydi */
  private readKeyFromEnvFile(): string {
    const candidates = [
      process.env.ANALYTICS_ENV_FILE,
      resolve(process.cwd(), '../analytics/.env'),
      resolve(process.cwd(), 'apps/analytics/.env'),
    ].filter((path): path is string => Boolean(path));

    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const match = /^\s*ANALYTICS_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(path, 'utf8'));
      if (match?.[1]) return match[1].trim();
    }
    this.logger.warn('ANALYTICS_KEY topilmadi — apps/analytics/.env faylini tekshiring');
    return '';
  }

  /** Python xizmatiga so'rov; javob JSON */
  async call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          'X-Analytics-Key': this.key,
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      });
    } catch (error) {
      this.logger.warn(`Tahlil xizmatiga ulanib bo'lmadi: ${String(error)}`);
      throw new ServiceUnavailableException(
        "Tahlil xizmati ishlamayapti. apps\\analytics papkasida run.ps1 ni ishga tushiring",
      );
    }

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text.slice(0, 300) };
    }

    if (!response.ok) {
      const detail = (data as { detail?: unknown } | null)?.detail;
      const message =
        typeof detail === 'string'
          ? detail
          : response.status === 401
            ? "Tahlil xizmati kaliti mos emas (ANALYTICS_KEY)"
            : `Tahlil xizmati xatosi (${response.status})`;
      if (response.status >= 500 || response.status === 401) {
        throw new ServiceUnavailableException(message);
      }
      throw new BadRequestException(message);
    }

    return data as T;
  }

  health() {
    return this.call<Record<string, unknown>>('/health', { timeoutMs: 10_000 });
  }

  /** Formulalar katalogi, ko'rsatkichlar va guruhlash turlari */
  catalog() {
    return this.call<Record<string, unknown>>('/formulas', { timeoutMs: 10_000 });
  }

  /** Formulani hisoblash */
  run(id: string, body: RunInput) {
    if (!/^[a-z0-9_]{2,40}$/.test(id)) throw new BadRequestException('Formula nomi noto\'g\'ri');
    const period = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!period.test(body.start ?? '') || !period.test(body.end ?? '')) {
      throw new BadRequestException('Davr noto\'g\'ri (YYYY-MM)');
    }
    if (body.start > body.end) throw new BadRequestException('Boshlanish oyi tugash oyidan keyin');

    const clean = (value: unknown) =>
      typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : undefined;

    return this.call<Record<string, unknown>>(`/formulas/${id}/run`, {
      method: 'POST',
      body: {
        start: body.start,
        end: body.end,
        metric: clean(body.metric),
        metric2: clean(body.metric2),
        groupBy: clean(body.groupBy),
      },
    });
  }

  /** Oy × hudud jadvali */
  panel(start: string, end: string) {
    const period = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!period.test(start ?? '') || !period.test(end ?? '')) {
      throw new BadRequestException('Davr noto\'g\'ri (YYYY-MM)');
    }
    return this.call<Record<string, unknown>>(`/panel?start=${start}&end=${end}`);
  }
}

export interface RunInput {
  start: string;
  end: string;
  metric?: string;
  metric2?: string;
  groupBy?: string;
}
