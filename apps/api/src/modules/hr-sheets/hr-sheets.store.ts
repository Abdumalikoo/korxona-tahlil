import type { PrismaService } from '../prisma/prisma.service';
import { HR_SHEET, HR_SHEETS, HR_UNIT_PATTERNS, isWorking, type HrSheetCode } from './hr-sheets.config';
import { openSnapshot } from './hr-sheets.crypto';

// ═══════════════════════════════════════════════════════════
// Ma'lumotnomalar ombori («miya» uchun umumiy o'qish).
//  • Har jadvalning oxirgi yuklangan holati — `settings` «hr.sheet.<KOD>» (oldingisi — «hr.sheet.<KOD>.prev»).
//    Migratsiya kerak emas.
//  • hrPeople() — hamma jadvallardan PINFL bo'yicha birlashtirilgan odamlar: F.I.Sh., lavozim, tuzilma, holat
//    va tuzilma nomidan aniqlangan bo'lim (Fermer, Tax free, Marksheyder …). 37-jadvalda PINFL yo'q —
//    F.I.Sh. bo'yicha bog'lanadi (bitta odamga to'g'ri kelsa).
//  • Natija 60 soniya xotirada turadi; yuklash / qaytarishda tozalanadi.
//  • Shaxsiy maydonlar bazada shifrlangan bo'lishi mumkin (hr-sheets.crypto.ts) — loadSnapshot ochib beradi.
// ═══════════════════════════════════════════════════════════

export interface HrSnapshot {
  code: HrSheetCode;
  batchId: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedById: string;
  /** Ustun kalitlari (rows ichidagi tartib) */
  cols: string[];
  rows: (string | null)[][];
}

export interface HrPerson {
  pinfl: string;
  fullName: string;
  position: string | null;
  /** Tuzilma / departament nomi (eng ishonchli manbadan) */
  place: string | null;
  status: string | null;
  working: boolean;
  /** Tuzilma nomidan aniqlangan bo'lim (yo'nalish) yoki null */
  unit: string | null;
  /** Qaysi jadvallarda bor */
  sources: HrSheetCode[];
}

export const sheetKey = (code: string) => `hr.sheet.${code}`;
export const prevKey = (code: string) => `hr.sheet.${code}.prev`;

/** F.I.Sh. solishtirish uchun: kichik harf, tutuq belgilari va bo'shliqlarsiz */
export function normName(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ʻʼ‘’'`´"«»]/g, '')
    .replace(/[^a-zа-яёқғўҳ0-9]/gi, '');
}

export function readSnapshot(raw: unknown): HrSnapshot | null {
  const v = raw as Partial<HrSnapshot> | null | undefined;
  if (!v || !Array.isArray(v.cols) || !Array.isArray(v.rows) || typeof v.code !== 'string') return null;
  return v as HrSnapshot;
}

/** Ochilgan (shifrdan) nusxalar — 60 soniya; yuklash / qaytarish / shifrlashda tozalanadi */
const opened = new Map<string, { at: number; snap: HrSnapshot }>();

/**
 * Saqlangan jadval. Shaxsiy maydonlar (pasport, telefon, manzil …) bazada shifrlangan bo'lishi mumkin —
 * decrypt=true (standart) bo'lsa ochiladi. «Miya» umumiy ro'yxati (hrPeople) ularni ishlatmaydi — ochmaydi.
 */
export async function loadSnapshot(prisma: PrismaService, code: string, prev = false, decrypt = true): Promise<HrSnapshot | null> {
  const key = prev ? prevKey(code) : sheetKey(code);
  const s = readSnapshot((await prisma.setting.findUnique({ where: { key } }))?.value ?? null);
  if (!s || !decrypt) return s;
  const ck = `${key}:${s.batchId}`;
  const hit = opened.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.snap;
  const { snap } = openSnapshot(s);
  opened.set(ck, { at: Date.now(), snap });
  return snap;
}

/** Qatorni kalit → qiymat ko'rinishiga */
export function rowObject(s: HrSnapshot, row: (string | null)[]): Record<string, string | null> {
  const o: Record<string, string | null> = {};
  s.cols.forEach((k, i) => (o[k] = row[i] ?? null));
  return o;
}

/** Tuzilma matnlaridan bo'lim */
export function unitOfPlace(...texts: (string | null | undefined)[]): string | null {
  const t = texts.filter(Boolean).join(' | ');
  if (!t) return null;
  for (const [unit, re] of Object.entries(HR_UNIT_PATTERNS)) if (re.test(t)) return unit;
  return null;
}

let cache: { at: number; people: Map<string, HrPerson> } | null = null;
const TTL_MS = 60_000;

export function clearHrCache(): void {
  cache = null;
  opened.clear();
}

/** Hamma ma'lumotnomalardan birlashtirilgan odamlar (PINFL → odam) */
export async function hrPeople(prisma: PrismaService): Promise<Map<string, HrPerson>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.people;
  const snaps = new Map<HrSheetCode, HrSnapshot>();
  for (const def of HR_SHEETS) {
    const s = await loadSnapshot(prisma, def.code, false, false).catch(() => null);
    if (s) snaps.set(def.code, s);
  }
  const people = new Map<string, HrPerson>();
  const touch = (pinfl: string, code: HrSheetCode, fullName: string | null, apply: (p: HrPerson) => void) => {
    let p = people.get(pinfl);
    if (!p) {
      p = { pinfl, fullName: fullName ?? pinfl, position: null, place: null, status: null, working: true, unit: null, sources: [] };
      people.set(pinfl, p);
    }
    if (!p.sources.includes(code)) p.sources.push(code);
    apply(p);
  };

  // Ustuvorlik: 10-jadval → 16-jadval → 51-jadval (oxirgi qatori) → 37-jadval (F.I.Sh. bo'yicha)
  for (const code of ['J10', 'J16', 'J51'] as const) {
    const s = snaps.get(code);
    const def = HR_SHEET(code)!;
    if (!s || !def.pinflKey) continue;
    for (const row of s.rows) {
      const o = rowObject(s, row);
      const pinfl = o[def.pinflKey];
      if (!pinfl || !/^\d{14}$/.test(pinfl)) continue;
      const place = def.placeKeys.map((k) => o[k]).filter(Boolean).join(' · ') || null;
      const unit = unitOfPlace(...def.placeKeys.map((k) => o[k]), def.positionKey ? o[def.positionKey] : null);
      const status = def.statusKey ? o[def.statusKey] : null;
      touch(pinfl, code, o[def.nameKey], (p) => {
        // Faqat shu jadvaldan ma'lum bo'lsa — qiymatlar shu jadvaldan (51-jadvalda keyingi qator — so'nggi holat);
        // aks holda yuqoriroq jadvaldagisi qoladi, bo'sh maydonlar to'ldiriladi
        const first = p.sources.every((x) => x === code);
        if (first || !p.place) p.place = place ?? p.place;
        if (first || !p.position) p.position = (def.positionKey ? o[def.positionKey] : null) ?? p.position;
        if (first || !p.unit) p.unit = unit ?? p.unit;
        if (status && (first || !p.status)) {
          p.status = status;
          p.working = isWorking(status);
        }
        if (p.fullName === pinfl && o[def.nameKey]) p.fullName = o[def.nameKey]!;
      });
    }
  }
  // 37-jadval: F.I.Sh. bo'yicha
  const s37 = snaps.get('J37');
  if (s37) {
    const byName = nameIndex(people);
    const def = HR_SHEET('J37')!;
    for (const row of s37.rows) {
      const o = rowObject(s37, row);
      const pins = byName.get(normName(o[def.nameKey]));
      if (!pins || pins.length !== 1) continue;
      const unit = unitOfPlace(o.lavozim);
      touch(pins[0]!, 'J37', o[def.nameKey], (p) => {
        if (!p.unit) p.unit = unit;
        if (!p.position) p.position = o.lavozim ?? null;
      });
    }
  }
  cache = { at: Date.now(), people };
  return people;
}

/** F.I.Sh. → PINFL'lar */
export function nameIndex(people: Map<string, { pinfl: string; fullName: string }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of people.values()) {
    const n = normName(p.fullName);
    if (!n) continue;
    const list = out.get(n) ?? [];
    if (!list.includes(p.pinfl)) list.push(p.pinfl);
    out.set(n, list);
  }
  return out;
}

/** «Miya» uchun: shu bo'limga tegishli (tuzilma nomi bo'yicha) va ishlayotgan odamlar */
export async function hrUnitStaff(prisma: PrismaService, unit: string): Promise<HrPerson[]> {
  if (!HR_UNIT_PATTERNS[unit]) return [];
  return [...(await hrPeople(prisma)).values()].filter((p) => p.unit === unit && p.working);
}