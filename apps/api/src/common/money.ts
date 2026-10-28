// ═══════════════════════════════════════════════════════════
// Pul: so'm → tiyin (BigInt). Bo'sh katak — 0, manfiy yoki son emas — null (chaqiruvchi xato beradi).
// Bo'sh joy va bo'linmas bo'sh joy olib tashlanadi, vergul — kasr belgisi.
// (Avval bo'lim ish haqi, ijara va bank yuklashlarida alohida nusxa edi — xatti-harakati bir xil.)
// Xonalarga ajratilgan matn («1,234,567.89», «1.234.567,89», «1'234,56») — alohida: statementTiyin (faqat bank
// ko'chirmasi va schyot-faktura); somToTiyin avvalgi nusxalar bilan aynan bir xil qoladi (t-common-helpers).
// ═══════════════════════════════════════════════════════════

/**
 * Matndagi son: oddiy usul (vergul — kasr), bo'lmasa xonalarga ajratilgan shakl. Son emas — null.
 * Noaniq «1,234» / «1.234» (bitta belgi) — kasr deb olinadi (oddiy usul).
 */
export function amountNumber(raw: string): number | null {
  const s = raw.replace(/[\s  ]/g, '');
  const plain = Number(s.replace(',', '.'));
  if (Number.isFinite(plain)) return plain;
  const t = s.replace(/['’ʼ`]/g, '');
  const m = /^(-?)(\d{1,3}([.,])\d{3}(?:\3\d{3})*|\d+)(?:([.,])(\d+))?$/.exec(t);
  if (!m) return null;
  const [, sign, int, group, dec, frac] = m;
  // Xona belgisi va kasr belgisi bir xil bo'lmasin («1,234,56» — noto'g'ri)
  if (group && dec && group === dec) return null;
  const n = Number(`${sign}${int!.replace(/[.,]/g, '')}${frac ? `.${frac}` : ''}`);
  return Number.isFinite(n) ? n : null;
}

/** so'm → tiyin. dashIsZero: «-» belgisi ham 0 (ijara jadvalida bo'sh oy shunday yoziladi) */
export function somToTiyin(v: unknown, opts: { dashIsZero?: boolean } = {}): bigint | null {
  if (v === null || v === undefined) return 0n;
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (s.trim() === '' || (opts.dashIsZero && s.trim() === '-')) return 0n;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 100)) : null;
  const n = Number(s.replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : null;
}

/** Bank ko'chirmasi / faktura summasi: somToTiyin, u rad etsa — xonalarga ajratilgan matn (manfiy — null) */
export function statementTiyin(v: unknown): bigint | null {
  const t = somToTiyin(v);
  if (t !== null || typeof v !== 'string') return t;
  const n = amountNumber(v);
  return n !== null && n >= 0 ? BigInt(Math.round(n * 100)) : null;
}