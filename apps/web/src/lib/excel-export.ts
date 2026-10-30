'use client';

import { pageIndex } from '@/components/layout/nav-config';
import { introFor } from '@/features/help/intros';
import { API_HEADERS, getToken } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Excel eksport — hamma sahifa uchun bitta: jadval brauzerdagidek olinadi, server undan tushunarli .xlsx yasaydi:
//  «Jadval» (bezatilgan, so'm va foiz formatlari, jami qatorlar), «Tushuntirish» (sahifa nima ko'rsatadi, har ustun
//  nima va qanday hisoblanadi, umumiy qoidalar, hisob-kitob), «Ma'lumot» (davr, sahifa, qachon).
// Sahifa nomi (menyudan), tushuntirishi (sahifa izohi) va davr (yuqori paneldagi «Davr») o'zi qo'shiladi.
// Server javob bermasa — eski CSV (yuklab olish to'xtab qolmaydi).
// ═══════════════════════════════════════════════════════════

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
type Cell = string | number | null;

/** Yuqori paneldagi davr (sahifalar bilan bir xil saqlanadi) */
function currentPeriod(): { from: string; to: string } | null {
  try {
    const v = JSON.parse(window.localStorage.getItem('korxona_period') ?? 'null') as { range?: { from?: unknown; to?: unknown } } | null;
    const from = v?.range?.from;
    const to = v?.range?.to;
    return typeof from === 'string' && typeof to === 'string' ? { from, to } : null;
  } catch {
    return null;
  }
}

/** Sahifa: nomi (menyudagi yo'l), izohi (nima, qayerdan, qanday) va manzili */
function currentPage() {
  const path = window.location.pathname;
  const entry = pageIndex(true).find((p) => p.href === path) ?? pageIndex(true).find((p) => p.href !== '/' && path.startsWith(`${p.href}/`));
  const intro = introFor(path);
  const heading = document.querySelector('h1')?.textContent?.trim() ?? '';
  return { path, name: entry?.trail ?? heading, what: intro?.what ?? entry?.description ?? '', from: intro?.from ?? '', how: intro?.how ?? '' };
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Jadvalni tushunarli Excel (.xlsx) qilib yuklab olish; xato bo'lsa — reject (chaqiruvchi CSV ga o'tadi) */
export async function exportXlsx(input: { fileName: string; header: string[]; rows: Cell[][]; workings?: Cell[][] }): Promise<void> {
  const page = currentPage();
  const token = getToken();
  const response = await fetch(`${BASE}/export/xlsx`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...API_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ fileName: input.fileName, title: page.name || input.fileName, page, period: currentPeriod(), header: input.header, rows: input.rows, workings: input.workings ?? [] }),
  });
  if (!response.ok) throw new Error(`Excel eksport: ${response.status}`);
  save(await response.blob(), `${input.fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'jadval'}.xlsx`);
}
