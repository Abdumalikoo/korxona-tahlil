import { Logger, ValidationPipe, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { securityHeaders } from './common/security/headers';
import { bodyLimits } from './common/security/body-limits';
import { csrfGuard } from './common/security/auth-cookie';

/**
 * BigInt JSON'ga seriyalanmaydi — bu Node.js cheklovi.
 * Pul tiyinda BigInt sifatida saqlanadi, shuning uchun
 * javobga chiqishdan oldin satrga o'giriladi.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (
  this: bigint,
): string {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const production = process.env.NODE_ENV === 'production';
  const logger: LogLevel[] = production ? ['log', 'error', 'warn'] : ['log', 'error', 'warn', 'debug'];
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger, bodyParser: false });

  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  // nginx ortida ishlasa — haqiqiy mijoz IP'si (kirish urinishlarini cheklash uchun): TRUST_PROXY=1
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  app.use(securityHeaders(production));

  // So'rov tanasi chegarasi: kirishsiz ochiq manzillarga — kichik (begona katta so'rov serverni band qilmasin),
  // kirgan foydalanuvchiga — katta (ish haqi, natijalar, ijara kabi katta jadvallar JSON bilan keladi)
  app.use(bodyLimits(process.env.BODY_LIMIT ?? '10mb'));
  // Sessiya cookie'si bilan kelgan o'zgartiruvchi so'rovlar — CSRF tekshiruvi
  app.use(csrfGuard());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS_ORIGINS="https://tahlil.example.uz,http://localhost:3000" (vergul bilan); bo'sh bo'lsa — faqat localhost
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen(port, host);

  Logger.log(`Server ishga tushdi: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api (${production ? 'production' : 'development'})`, 'Bootstrap');
}

void bootstrap();