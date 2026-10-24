import { SetMetadata } from '@nestjs/common';

export const PERSONAL_KEY = 'personal-data';

/**
 * Shaxsiy ma'lumot (JShShIR, ism-familiya ro'yxati, shaxsiy ish haqi) qaytaradigan marshrut.
 *  • 'deny' — Kuzatuvchi (VIEWER) uchun yopiq (administrator Sozlamalar › Xavfsizlik'da ochishi mumkin);
 *  • 'mask' — Kuzatuvchiga beriladi, lekin JShShIR yashiriladi, pasport/telefon/manzil olib tashlanadi;
 *  • false  — sinf darajasidagi belgini shu marshrut uchun bekor qiladi (masalan, umumiy statistika).
 * Administrator va ishchi rollarga ta'sir qilmaydi (ishchilar baribir faqat o'z bo'limida).
 */
export type PersonalMode = 'deny' | 'mask' | false;
export const Personal = (mode: PersonalMode = 'deny') => SetMetadata(PERSONAL_KEY, mode);