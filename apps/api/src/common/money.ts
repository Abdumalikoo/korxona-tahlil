// ═══════════════════════════════════════════════════════════
// Pul: so'm → tiyin (BigInt). Bo'sh katak — 0, manfiy yoki son emas — null (chaqiruvchi xato beradi).
// Bo'sh joy va bo'linmas bo'sh joy olib tashlanadi, vergul — kasr belgisi.
// (Avval bo'lim ish haqi, ijara va bank yuklashlarida alohida nusxa edi — xatti-harakati bir xil.)
// ═══════════════════════════════════════════════════════════

/** so'm → tiyin. dashIsZero: «-» belgisi ham 0 (ijara jadvalida bo'sh oy shunday yoziladi) */
export function somToTiyin(v: unknown, opts: { dashIsZero?: boolean } = {}): bigint | null {
  if (v === null || v === undefined) return 0n;
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (s.trim() === '' || (opts.dashIsZero && s.trim() === '-')) return 0n;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 100)) : null;
  const n = Number(s.replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : null;
}