import { defineConfig } from '@playwright/test';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════
// Brauzer orqali tekshiruv (smoke): asosiy sahifalar ochiladimi, xato chiqmaydimi, asosiy elementlar bormi.
// Ishga tushirish: ilova ishlab turgan bo'lsin (ishga-tushir.ps1), keyin — `pnpm e2e`.
// Brauzer yuklab olinmaydi — kompyuterdagi Microsoft Edge ishlatiladi.
// Kirish: parolsiz — lokal .env dagi kalit bilan vaqtinchalik (1 soatlik) token (global-setup.ts); faqat lokal baza.
// Testlar ma'lumot yozmaydi — faqat ochadi va bosadi (yorliqlar, ro'yxatlar).
// ═══════════════════════════════════════════════════════════

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    channel: 'msedge',
    headless: true,
    storageState: path.join(__dirname, '.auth/state.json'),
    locale: 'uz-UZ',
    trace: 'retain-on-failure',
  },
});
