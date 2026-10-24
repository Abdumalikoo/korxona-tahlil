// ═══════════════════════════════════════════════════════════
// Kalit bo'yicha navbat (mutex) — «o'qib → o'zgartirib → yozish» amallari uchun.
//
// Ko'p sozlamalar bitta JSON yozuvda saqlanadi (settings jadvali). Ikki so'rov bir vaqtda
// o'qib, har biri o'z o'zgarishini yozsa — birinchisining o'zgarishi yo'qoladi.
// runExclusive(kalit, fn) bir xil kalitli amallarni navbat bilan bajaradi:
//  • har xil kalitlar bir-birini kutmaydi;
//  • xato bo'lsa ham navbat davom etadi;
//  • bitta kalitda juda uzoq kutilsa (60 s) — xato beriladi, osilib qolmaydi.
//
// Eslatma: navbat bitta API jarayoni ichida ishlaydi (hozirgi o'rnatish shunday).
// Bir nechta nusxa ishga tushirilsa — Postgres advisory lock'ga o'tish kerak (yo'l xaritasi, 2-bosqich).
// ═══════════════════════════════════════════════════════════

import { ConflictException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Shu so'rov zanjiri ushlab turgan kalitlar — ichma-ich chaqiruv o'zini o'zi kutib qolmasin */
const held = new AsyncLocalStorage<ReadonlySet<string>>();

const tails = new Map<string, Promise<unknown>>();

/** Kutish chegarasi: shundan oshsa, amal bajarilmaydi */
export const LOCK_WAIT_MS = 60_000;

export class LockTimeoutError extends ConflictException {
  constructor(key: string) {
    super(`Bir vaqtda ko'p o'zgartirish — «${key}» band. Birozdan keyin qayta urinib ko'ring`);
  }
}

export async function runExclusive<T>(key: string, fn: () => Promise<T>, waitMs = LOCK_WAIT_MS): Promise<T> {
  const mineSet = held.getStore();
  if (mineSet?.has(key)) return fn(); // shu zanjir allaqachon ushlab turibdi
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  tails.set(key, tail);

  let timer: NodeJS.Timeout | undefined;
  try {
    const waited = await Promise.race([
      prev.then(
        () => true,
        () => true,
      ),
      new Promise<false>((r) => {
        timer = setTimeout(() => r(false), waitMs);
        timer.unref?.();
      }),
    ]);
    if (!waited) throw new LockTimeoutError(key);
    const next = new Set(mineSet ?? []);
    next.add(key);
    return await held.run(next, fn);
  } finally {
    if (timer) clearTimeout(timer);
    release();
    // Navbat bo'shasa — xotirada qolmasin
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** Sinov va kuzatuv uchun: hozir band kalitlar soni */
export function activeLocks(): number {
  return tails.size;
}