import { ApiError } from './api';

/**
 * Har qanday xatodan foydalanuvchiga ko'rsatiladigan xabar chiqaradi.
 *
 * Serverdan kelgan aniq sababni afzal ko'radi, topilmasa
 * umumiy xabarga qaytadi.
 */
export function errorMessage(error: unknown, fallback = 'Xatolik yuz berdi'): string {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }

  if (error instanceof Error) {
    // Tarmoq xatolari
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return "Server bilan bog'lanib bo'lmadi. Internetni tekshiring";
    }
    return error.message || fallback;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}

/** Xato jiddiyligini aniqlaydi — qanday ko'rsatishni tanlash uchun */
export function errorTone(error: unknown): 'error' | 'warning' {
  if (error instanceof ApiError) {
    // 400 — foydalanuvchi xatosi, 500 — tizim xatosi
    return error.statusCode >= 500 ? 'error' : 'warning';
  }
  return 'error';
}
